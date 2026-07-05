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
