import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  DocsService,
  stripHtml,
  extractLinks,
  mergeSearchResults
} from '../../src/backend/services/context/docs.js';
import { RagIndex } from '../../src/backend/services/context/rag.js';
import type { DocSite } from '../../src/backend/config/config-manager.js';

describe('stripHtml', () => {
  it('extracts the title and strips scripts/styles/nav/chrome', () => {
    const { title, text } = stripHtml(
      '<html><head><title>My Page</title><style>.x{}</style></head>' +
        '<body><nav>Menu</nav><script>alert(1)</script>' +
        '<p>Hello world</p><footer>Foot</footer></body></html>'
    );
    expect(title).toBe('My Page');
    expect(text).toContain('Hello world');
    expect(text).not.toContain('Menu');
    expect(text).not.toContain('alert');
    expect(text).not.toContain('Foot');
  });

  it('decodes common HTML entities', () => {
    const { text } = stripHtml('<p>a &lt;b&gt; &amp; &quot;c&quot; &#233;</p>');
    expect(text).toBe('a <b> & "c" é');
  });
});

describe('extractLinks', () => {
  it('resolves relative links against the base URL and drops fragments', () => {
    const links = extractLinks(
      '<a href="intro">intro</a> <a href="/docs/deep#section">deep</a>',
      'https://site.dev/docs/'
    );
    expect(links).toContain('https://site.dev/docs/intro');
    expect(links).toContain('https://site.dev/docs/deep');
    expect(links.every(l => !l.includes('#'))).toBe(true);
  });

  it('keeps only http(s) links', () => {
    const links = extractLinks(
      '<a href="mailto:x@y.z">mail</a> <a href="javascript:void(0)">js</a> <a href="https://ok.dev/a">ok</a>',
      'https://site.dev/'
    );
    expect(links).toEqual(['https://ok.dev/a']);
  });
});

describe('mergeSearchResults', () => {
  it('merges lists sorted by score and truncates to topK', () => {
    const a = [{ path: 'a', startLine: 1, endLine: 1, snippet: '', score: 0.9 }];
    const b = [
      { path: 'b', startLine: 1, endLine: 1, snippet: '', score: 0.95 },
      { path: 'c', startLine: 1, endLine: 1, snippet: '', score: 0.1 }
    ];
    const merged = mergeSearchResults(2, a, b);
    expect(merged.map(r => r.path)).toEqual(['b', 'a']);
  });
});

describe('RagIndex.removeByPrefix', () => {
  it('removes only documents whose path starts with the prefix', () => {
    const index = new RagIndex();
    index.addDocument('docs:site1:https://a', 'svelte runes documentation');
    index.addDocument('docs:site2:https://b', 'svelte runes documentation');
    index.addDocument('src/local.md', 'svelte runes documentation');
    index.removeByPrefix('docs:site1:');
    const paths = index.search('svelte runes').map(r => r.path);
    expect(paths).not.toContain('docs:site1:https://a');
    expect(paths).toContain('docs:site2:https://b');
    expect(paths).toContain('src/local.md');
  });
});

describe('DocsService', () => {
  let tmpDir: string;

  const site: DocSite = {
    id: 'site-1',
    title: 'Fake Docs',
    startUrl: 'https://docs.example/guide/',
    enabled: true
  };

  /** Faux site web : Map url → html, servie par un fetch injecté. */
  const pages = new Map<string, string>([
    [
      'https://docs.example/guide/',
      '<title>Guide</title><p>welcome to the guide about wombats</p>' +
        '<a href="/guide/install">install</a>' +
        '<a href="/guide/usage">usage</a>' +
        '<a href="/other/outside">outside prefix</a>' +
        '<a href="https://elsewhere.example/x">cross origin</a>'
    ],
    ['https://docs.example/guide/install', '<title>Install</title><p>installing wombat tooling</p>'],
    ['https://docs.example/guide/usage', '<title>Usage</title><p>using wombats daily</p>'],
    ['https://docs.example/other/outside', '<title>Outside</title><p>should never be crawled</p>']
  ]);

  function fakeFetch(url: string | URL | Request): Promise<Response> {
    const key = String(url);
    const html = pages.get(key);
    if (!html) return Promise.resolve(new Response('nope', { status: 404 }));
    return Promise.resolve(
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })
    );
  }

  function makeService(overrides: Partial<ConstructorParameters<typeof DocsService>[0]> = {}) {
    return new DocsService({
      cacheDir: tmpDir,
      fetchFn: fakeFetch as typeof fetch,
      requestDelayMs: 0,
      ...overrides
    });
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-docs-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('crawls same-origin pages under the path prefix and indexes them', async () => {
    const service = makeService();
    const { pages: count } = await service.indexSite(site);
    expect(count).toBe(3); // /guide/, /guide/install, /guide/usage — pas /other/ ni cross-origin

    const results = service.search('wombat install');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path.startsWith('docs:site-1:')).toBe(true);
  });

  it('writes meta.json and page files to the cache directory', async () => {
    const service = makeService();
    await service.indexSite(site);
    const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, 'site-1', 'meta.json'), 'utf-8'));
    expect(meta.pages).toHaveLength(3);
    expect(meta.startUrl).toBe(site.startUrl);
    for (const page of meta.pages) {
      expect(fs.existsSync(path.join(tmpDir, 'site-1', 'pages', page.file))).toBe(true);
    }
  });

  it('honors maxPages', async () => {
    const service = makeService({ maxPages: 1 });
    const { pages: count } = await service.indexSite(site);
    expect(count).toBe(1);
  });

  it('rehydrates the index from cache on a fresh instance', async () => {
    await makeService().indexSite(site);
    const fresh = makeService();
    expect(fresh.search('wombat').length).toBe(0);
    await fresh.loadFromCache([site]);
    expect(fresh.search('wombat').length).toBeGreaterThan(0);
  });

  it('reports site statuses from meta.json', async () => {
    const service = makeService();
    await service.indexSite(site);
    const statuses = await service.getSiteStatuses([site, { ...site, id: 'unknown' }]);
    expect(statuses.find(s => s.id === 'site-1')!.pages).toBe(3);
    expect(statuses.find(s => s.id === 'unknown')!.pages).toBe(0);
  });

  it('removeSite clears both the index and the disk cache', async () => {
    const service = makeService();
    await service.indexSite(site);
    await service.removeSite(site.id);
    expect(service.search('wombat')).toHaveLength(0);
    expect(fs.existsSync(path.join(tmpDir, 'site-1'))).toBe(false);
  });

  it('skips non-HTML responses', async () => {
    const jsonFetch = () =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
      );
    const service = makeService({ fetchFn: jsonFetch as typeof fetch });
    const { pages: count } = await service.indexSite(site);
    expect(count).toBe(0);
  });
});
