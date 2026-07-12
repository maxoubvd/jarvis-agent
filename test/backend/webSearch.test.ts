import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../../src/backend/config/config-manager.js', () => ({
  getConfigManager: () => ({
    getConfig: () => mockConfig.current
  }),
  DEFAULT_WEB_SEARCH_SITES: ['stackoverflow.com', 'developer.mozilla.org', 'github.com', 'devdocs.io']
}));

import { webSearch } from '../../src/backend/core/mcp/tools/webSearch.js';
import { DEFAULT_WEB_SEARCH_SITES } from '../../src/backend/config/config-manager.js';

function ddgHtml(results: { url: string; title: string; snippet: string }[]): string {
  return results
    .map(
      r => `
      <div class="result results_links results_links_deep web-result">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}&amp;rut=1">${r.title}</a>
          </h2>
          <a class="result__snippet" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(r.url)}">${r.snippet}</a>
        </div>
      </div>`
    )
    .join('\n');
}

beforeEach(() => {
  mockConfig.current = {};
  vi.restoreAllMocks();
});

describe('webSearch (DuckDuckGo HTML, free — no API key)', () => {
  it('queries DuckDuckGo and formats results as a markdown list, without needing any config', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        ddgHtml([{ url: 'https://svelte.dev/docs/runes', title: 'Svelte 5 runes', snippet: 'Runes are...' }])
    } as Response);

    const result = await webSearch('svelte runes');
    expect(result).toBe('- [Svelte 5 runes](https://svelte.dev/docs/runes): Runes are...');

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('html.duckduckgo.com');
    expect(calledUrl).toContain(encodeURIComponent('svelte runes'));
  });

  it('falls back to DEFAULT_WEB_SEARCH_SITES when webSearch was never configured', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ddgHtml([])
    } as Response);

    await webSearch('runes');
    const calledUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    for (const site of DEFAULT_WEB_SEARCH_SITES) {
      expect(calledUrl).toContain(`site:${site}`);
    }
  });

  it('translates model-provided sites into site: OR operators', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ddgHtml([])
    } as Response);

    await webSearch('runes', { sites: ['svelte.dev', 'developer.mozilla.org'] });
    const calledUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl).toContain('site:svelte.dev OR site:developer.mozilla.org');
  });

  it('falls back to config.defaultSites only when the model omits sites', async () => {
    mockConfig.current = { webSearch: { provider: 'duckduckgo', defaultSites: ['mdn.io'] } };
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => ddgHtml([])
    } as Response);

    await webSearch('runes', { sites: ['svelte.dev'] });
    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toContain('site:svelte.dev');
    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).not.toContain('mdn.io');

    await webSearch('runes');
    expect(decodeURIComponent(fetchMock.mock.calls[1][0] as string)).toContain('site:mdn.io');
  });

  it('reports an HTTP error without throwing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    expect(await webSearch('x')).toContain('HTTP 500');
  });

  it('reports a network failure without throwing', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));
    expect(await webSearch('x')).toContain('network down');
  });

  it('reports an empty-results message', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<html><body>no results here</body></html>'
    } as Response);
    expect(await webSearch('x')).toBe('(no results)');
  });

  it('strips HTML tags and decodes entities from titles and snippets', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        ddgHtml([
          {
            url: 'https://example.com',
            title: 'Fish &amp; Chips <b>recipe</b>',
            snippet: 'A &quot;classic&quot; <b>dish</b>'
          }
        ])
    } as Response);

    const result = await webSearch('fish and chips');
    expect(result).toBe('- [Fish & Chips recipe](https://example.com): A "classic" dish');
  });
});
