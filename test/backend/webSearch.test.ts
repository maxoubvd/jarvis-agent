import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfig = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('../../src/backend/config/config-manager.js', () => ({
  getConfigManager: () => ({
    getConfig: () => mockConfig.current
  })
}));

import { webSearch } from '../../src/backend/core/mcp/tools/webSearch.js';

beforeEach(() => {
  mockConfig.current = {};
  vi.restoreAllMocks();
});

describe('webSearch (Brave Search API)', () => {
  it('returns the unconfigured fallback when no API key is set (unchanged from the stub)', async () => {
    const result = await webSearch('svelte runes');
    expect(result).toContain('non configuré');
  });

  it('queries Brave and formats results as a markdown list', async () => {
    mockConfig.current = { webSearch: { provider: 'brave', apiKey: 'test-key' } };
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        web: { results: [{ title: 'Svelte 5 runes', url: 'https://svelte.dev/docs/runes', description: 'Runes are...' }] }
      })
    } as Response);

    const result = await webSearch('svelte runes');
    expect(result).toBe('- [Svelte 5 runes](https://svelte.dev/docs/runes): Runes are...');

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent('svelte runes'));
    const calledOpts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((calledOpts.headers as Record<string, string>)['X-Subscription-Token']).toBe('test-key');
  });

  it('translates model-provided sites into site: OR operators', async () => {
    mockConfig.current = { webSearch: { provider: 'brave', apiKey: 'k' } };
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ web: { results: [] } })
    } as Response);

    await webSearch('runes', { sites: ['svelte.dev', 'developer.mozilla.org'] });
    const calledUrl = decodeURIComponent(fetchMock.mock.calls[0][0] as string);
    expect(calledUrl).toContain('site:svelte.dev OR site:developer.mozilla.org');
  });

  it('falls back to config.defaultSites only when the model omits sites', async () => {
    mockConfig.current = { webSearch: { provider: 'brave', apiKey: 'k', defaultSites: ['mdn.io'] } };
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ web: { results: [] } })
    } as Response);

    await webSearch('runes', { sites: ['svelte.dev'] });
    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).toContain('site:svelte.dev');
    expect(decodeURIComponent(fetchMock.mock.calls[0][0] as string)).not.toContain('mdn.io');

    await webSearch('runes');
    expect(decodeURIComponent(fetchMock.mock.calls[1][0] as string)).toContain('site:mdn.io');
  });

  it('reports an HTTP error without throwing', async () => {
    mockConfig.current = { webSearch: { provider: 'brave', apiKey: 'k' } };
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    expect(await webSearch('x')).toContain('HTTP 500');
  });

  it('reports an empty-results message', async () => {
    mockConfig.current = { webSearch: { provider: 'brave', apiKey: 'k' } };
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ web: { results: [] } })
    } as Response);
    expect(await webSearch('x')).toBe('(aucun résultat)');
  });
});
