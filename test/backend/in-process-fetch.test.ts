import { describe, it, expect, vi, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFetchServer, htmlToMarkdown } from '../../packages/core/src/core/mcp/in-process.js';

function stubFetch(body: string, init: { ok?: boolean; status?: number; contentType?: string } = {}) {
  const { ok = true, status = 200, contentType = 'text/html; charset=utf-8' } = init;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok,
      status,
      statusText: ok ? 'OK' : 'Not Found',
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
      text: async () => body
    })
  );
}

async function connectClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createFetchServer().connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.1' }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map(c => c.text ?? '').join('\n');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('htmlToMarkdown', () => {
  it('converts headings, links and lists; strips scripts/styles', () => {
    const md = htmlToMarkdown(
      '<html><head><title>x</title></head><body>' +
        '<script>evil()</script><style>.a{}</style>' +
        '<h1>Title</h1><p>Hello &amp; welcome</p>' +
        '<ul><li>one</li><li>two</li></ul>' +
        '<a href="https://ex.com/doc">docs</a>' +
        '</body></html>'
    );
    expect(md).toContain('# Title');
    expect(md).toContain('Hello & welcome');
    expect(md).toContain('- one');
    expect(md).toContain('[docs](https://ex.com/doc)');
    expect(md).not.toContain('evil');
    expect(md).not.toContain('<');
  });
});

describe('in-process fetch server (InMemoryTransport)', () => {
  it('exposes a single "fetch" tool', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name)).toEqual(['fetch']);
    expect(tools[0].inputSchema.required).toEqual(['url']);
    await client.close();
  });

  it('fetches a page and returns markdown', async () => {
    stubFetch('<html><body><h2>Doc</h2><p>content here</p></body></html>');
    const client = await connectClient();
    const result = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com' } });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('## Doc');
    expect(textOf(result)).toContain('content here');
    await client.close();
  });

  it('windows the content with max_length/start_index and signals truncation', async () => {
    stubFetch('a'.repeat(100), { contentType: 'text/plain' });
    const client = await connectClient();
    const first = await client.callTool({
      name: 'fetch',
      arguments: { url: 'https://example.com', max_length: 40 }
    });
    expect(textOf(first)).toContain('start_index=40');
    const second = await client.callTool({
      name: 'fetch',
      arguments: { url: 'https://example.com', max_length: 60, start_index: 40 }
    });
    expect(textOf(second)).toBe('a'.repeat(60));
    await client.close();
  });

  it('rejects non-http(s) urls', async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: 'fetch', arguments: { url: 'file:///etc/passwd' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Invalid url');
    await client.close();
  });

  it('reports HTTP errors as tool errors', async () => {
    stubFetch('nope', { ok: false, status: 404 });
    const client = await connectClient();
    const result = await client.callTool({ name: 'fetch', arguments: { url: 'https://example.com/x' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('HTTP 404');
    await client.close();
  });
});
