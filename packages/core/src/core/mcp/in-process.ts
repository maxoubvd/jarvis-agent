import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const DEFAULT_MAX_LENGTH = 5000;

/** Decodes common HTML entities (no dependency). */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#?\w+;/g, ' ');
}

/**
 * HTML → markdown-lite conversion via regex: enough to give the model
 * readable content (headings, links, lists) without embedding a real parser.
 */
export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) =>
      `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`)
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').trim();
      return label && href && !href.startsWith('#') ? `[${label}](${href})` : label;
    })
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|li|ul|ol|table|tr|blockquote|pre|figure|header|footer|main)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface FetchArgs {
  url: string;
  maxLength: number;
  startIndex: number;
  raw: boolean;
}

/** Fetches the URL and returns the extracted content (windowed by start_index/max_length). */
async function fetchAsText({ url, maxLength, startIndex, raw }: FetchArgs): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'JarvisAgent/0.1 (VS Code extension; MCP fetch)' },
    redirect: 'follow'
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} — ${url}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  const isHtml = contentType.includes('html') || /^\s*<(!doctype|html)/i.test(body);
  const content = raw || !isHtml ? body : htmlToMarkdown(body);

  const windowed = content.slice(startIndex, startIndex + maxLength);
  if (startIndex >= content.length) {
    return `<error>start_index (${startIndex}) is beyond the end of the content (${content.length} chars).</error>`;
  }
  const remaining = content.length - (startIndex + windowed.length);
  return remaining > 0
    ? `${windowed}\n\n<truncated>Content truncated. Call fetch again with start_index=${startIndex + windowed.length} to read the remaining ${remaining} characters.</truncated>`
    : windowed;
}

/**
 * In-process "fetch" MCP server: same surface as the official Python
 * server (`uvx mcp-server-fetch`) but implemented in Node inside the
 * extension — zero external dependency, connects via an InMemoryTransport pair.
 */
export function createFetchServer(): Server {
  const server = new Server(
    { name: 'jarvis-fetch', version: '0.0.1' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'fetch',
        description:
          'Fetches a URL from the internet and extracts its content as markdown. ' +
          'Use start_index to paginate through long pages.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'URL to fetch' },
            max_length: {
              type: 'integer',
              description: `Maximum number of characters to return (default ${DEFAULT_MAX_LENGTH})`
            },
            start_index: {
              type: 'integer',
              description: 'Start the returned content at this character offset (default 0)'
            },
            raw: {
              type: 'boolean',
              description: 'Return the raw content without markdown conversion (default false)'
            }
          },
          required: ['url']
        }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    if (request.params.name !== 'fetch') {
      return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
    }
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const url = typeof args.url === 'string' ? args.url : '';
    if (!/^https?:\/\//i.test(url)) {
      return { content: [{ type: 'text', text: `Invalid url: "${url}" (http/https only)` }], isError: true };
    }
    try {
      const text = await fetchAsText({
        url,
        maxLength: typeof args.max_length === 'number' && args.max_length > 0 ? args.max_length : DEFAULT_MAX_LENGTH,
        startIndex: typeof args.start_index === 'number' && args.start_index > 0 ? args.start_index : 0,
        raw: args.raw === true
      });
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Fetch failed: ${msg}` }], isError: true };
    }
  });

  return server;
}

/** Built-in servers implemented in the extension (InMemoryTransport connection). */
export const IN_PROCESS_SERVERS: Record<string, () => Server> = {
  fetch: createFetchServer
};
