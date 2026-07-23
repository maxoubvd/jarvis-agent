import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../../packages/core/src/models/providers/ollama.js';
import { LMStudioProvider } from '../../packages/core/src/models/providers/lmstudio.js';
import type { ChatMessage } from '../../packages/core/src/models/abstract.js';

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

describe('structured outputs (JSON object mode)', () => {
  it('OpenAI-compatible sends response_format when requested', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'test' });
    await provider.sendPrompt(messages, undefined, undefined, { responseFormat: 'json_object' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('OpenAI-compatible omits response_format by default', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'test' });
    await provider.sendPrompt(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect('response_format' in body).toBe(false);
  });

  it('Ollama maps json_object to format:"json"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: { content: '{}' } })));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OllamaProvider({ model: 'test' });
    await provider.sendPrompt(messages, undefined, undefined, { responseFormat: 'json_object' });

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.format).toBe('json');
  });
});

describe('prompt cache usage stats', () => {
  it('extracts cached_tokens from the OpenAI usage block (non-stream)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 64 } }
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'test' });
    const res = await provider.sendPrompt(messages);
    const result = typeof res === 'string' ? { usage: undefined } : res;

    expect(result.usage?.cachedTokens).toBe(64);
    expect(result.usage?.promptTokens).toBe(100);
  });

  it('reads DeepSeek prompt_cache_hit_tokens as cachedTokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 80, completion_tokens: 10, prompt_cache_hit_tokens: 48 }
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'test' });
    const res = await provider.sendPrompt(messages);
    const result = typeof res === 'string' ? { usage: undefined } : res;

    expect(result.usage?.cachedTokens).toBe(48);
  });

  it('requests usage on the stream and surfaces it via onDone', async () => {
    const body = streamingResponse([
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hi' } }] }) + '\n',
      'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 50, prompt_tokens_details: { cached_tokens: 32 } } }) + '\n',
      'data: [DONE]\n'
    ]);
    const fetchMock = vi.fn().mockResolvedValue(body);
    vi.stubGlobal('fetch', fetchMock);

    const provider = new LMStudioProvider({ model: 'test' });
    let cached: number | undefined;
    await provider.sendPromptStream(
      messages,
      () => {},
      (_tc, usage) => { cached = usage?.cachedTokens; },
      err => { throw err; }
    );

    const reqBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(reqBody.stream_options).toEqual({ include_usage: true });
    expect(cached).toBe(32);
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
