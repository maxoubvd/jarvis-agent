import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/backend/models/providers/ollama.js';
import { LMStudioProvider } from '../../src/backend/models/providers/lmstudio.js';
import type { ChatMessage } from '../../src/backend/models/abstract.js';

/** Builds a Response whose body streams the given string chunks. */
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, { status: 200 });
}

const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OllamaProvider streaming', () => {
  it('assembles NDJSON message chunks in order', async () => {
    const body = streamingResponse([
      JSON.stringify({ message: { content: 'Hel' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'lo ' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'world' }, done: true }) + '\n'
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body));

    const provider = new OllamaProvider({ model: 'test' });
    const received: string[] = [];
    let done = false;

    await provider.sendPromptStream(
      messages,
      c => received.push(c),
      () => { done = true; },
      err => { throw err; }
    );

    expect(received.join('')).toBe('Hello world');
    expect(done).toBe(true);
  });

  it('reports HTTP errors through onError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const provider = new OllamaProvider();
    let error: Error | null = null;

    await provider.sendPromptStream(messages, () => {}, () => {}, e => { error = e; });
    expect(error).not.toBeNull();
  });
});

describe('temperature forwarding (model profiles)', () => {
  it('OpenAI-compatible providers send temperature when configured', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'codestral-latest', temperature: 0.1 });
    await provider.sendPrompt(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.1);
  });

  it('omits temperature when not configured (API default)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'test' });
    await provider.sendPrompt(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect('temperature' in body).toBe(false);
  });

  it('Ollama sends temperature via options', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: { content: 'ok' } })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider({ model: 'qwen2.5-coder:7b', temperature: 0.15 });
    await provider.sendPrompt(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.options.temperature).toBe(0.15);
  });
});

describe('LMStudioProvider streaming (OpenAI-compatible SSE)', () => {
  it('parses SSE data lines and stops at [DONE]', async () => {
    const body = streamingResponse([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'foo' } }] }) + '\n',
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'bar' } }] }) + '\n',
      'data: [DONE]\n'
    ]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(body));

    const provider = new LMStudioProvider({ model: 'test' });
    const received: string[] = [];
    let done = false;

    await provider.sendPromptStream(
      messages,
      c => received.push(c),
      () => { done = true; },
      err => { throw err; }
    );

    expect(received.join('')).toBe('foobar');
    expect(done).toBe(true);
  });
});
