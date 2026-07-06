import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { RagIndex, RagSearchResult } from './rag.js';
import type { DocSite } from '../../config/config-manager.js';

/**
 * Section Docs (façon Continue) : récupère un site de documentation par crawl
 * léger (même origine + même préfixe de chemin), met les pages en cache sur
 * disque (`~/.jarvis/docs/<id>/`) et les indexe dans un RagIndex **séparé** —
 * l'index workspace fait `clear()` à chaque réindexation et effacerait les
 * docs si elles y vivaient.
 *
 * Pur Node (aucun import vscode) — testable via les options injectables.
 */

export interface DocsServiceOptions {
  cacheDir?: string;
  fetchFn?: typeof fetch;
  maxPages?: number;
  requestDelayMs?: number;
  fetchTimeoutMs?: number;
}

export interface DocsSiteStatus {
  id: string;
  pages: number;
  indexedAt?: string;
}

interface SiteMeta {
  id: string;
  title: string;
  startUrl: string;
  indexedAt: string;
  pages: Array<{ url: string; title: string; file: string }>;
}

/** Extrait le titre et le texte lisible d'une page HTML (sans dépendance). */
export function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Conserve des sauts de ligne aux frontières de blocs pour le chunking.
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|pre|blockquote)>/gi, '\n')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

  return { title, text };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Liens absolus http(s) d'une page, résolus contre `baseUrl`, sans fragment. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      url.hash = '';
      links.add(url.toString());
    } catch {
      /* href invalide — ignoré */
    }
  }
  return [...links];
}

/** Préfixe de répertoire du chemin de départ (`/docs/intro` → `/docs/`). */
function pathPrefixOf(startUrl: URL): string {
  const p = startUrl.pathname;
  if (p.endsWith('/')) return p;
  const lastSlash = p.lastIndexOf('/');
  return p.slice(0, lastSlash + 1);
}

function normalizeForDedupe(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/** Fusionne des résultats de recherche de plusieurs index, triés par score. */
export function mergeSearchResults(
  topK: number,
  ...lists: RagSearchResult[][]
): RagSearchResult[] {
  return lists
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export class DocsService {
  public readonly index = new RagIndex();

  private readonly cacheDir: string;
  private readonly fetchFn: typeof fetch;
  private readonly maxPages: number;
  private readonly requestDelayMs: number;
  private readonly fetchTimeoutMs: number;

  constructor(options: DocsServiceOptions = {}) {
    this.cacheDir = options.cacheDir ?? path.join(os.homedir(), '.jarvis', 'docs');
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.maxPages = options.maxPages ?? 50;
    this.requestDelayMs = options.requestDelayMs ?? 250;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? 15000;
  }

  private siteDir(id: string): string {
    return path.join(this.cacheDir, id);
  }

  private indexPrefix(id: string): string {
    return `docs:${id}:`;
  }

  /** Crawl BFS + cache disque + indexation RAG. Remplace tout index/cache existant du site. */
  public async indexSite(
    site: DocSite,
    onProgress?: (pages: number) => void
  ): Promise<{ pages: number }> {
    const start = new URL(site.startUrl);
    const prefix = pathPrefixOf(start);

    this.index.removeByPrefix(this.indexPrefix(site.id));
    const pagesDir = path.join(this.siteDir(site.id), 'pages');
    await fs.rm(this.siteDir(site.id), { recursive: true, force: true });
    await fs.mkdir(pagesDir, { recursive: true });

    const queue: string[] = [start.toString()];
    const seen = new Set<string>([normalizeForDedupe(start.toString())]);
    const pages: SiteMeta['pages'] = [];

    while (queue.length > 0 && pages.length < this.maxPages) {
      const url = queue.shift()!;
      const html = await this.fetchPage(url);
      if (html === null) continue;

      const { title, text } = stripHtml(html);
      if (text) {
        const file = crypto.createHash('sha1').update(url).digest('hex') + '.txt';
        await fs.writeFile(path.join(pagesDir, file), text, 'utf-8');
        this.index.addDocument(this.indexPrefix(site.id) + url, text);
        pages.push({ url, title: title || url, file });
        onProgress?.(pages.length);
      }

      for (const link of extractLinks(html, url)) {
        const linkUrl = new URL(link);
        if (linkUrl.origin !== start.origin) continue;
        if (!linkUrl.pathname.startsWith(prefix)) continue;
        const key = normalizeForDedupe(link);
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push(link);
      }

      if (this.requestDelayMs > 0 && queue.length > 0 && pages.length < this.maxPages) {
        await new Promise(resolve => setTimeout(resolve, this.requestDelayMs));
      }
    }

    const meta: SiteMeta = {
      id: site.id,
      title: site.title,
      startUrl: site.startUrl,
      indexedAt: new Date().toISOString(),
      pages
    };
    await fs.writeFile(path.join(this.siteDir(site.id), 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

    return { pages: pages.length };
  }

  /** GET politesse : timeout, UA dédié, HTML 2xx uniquement, jamais de throw. */
  private async fetchPage(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await this.fetchFn(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'JarvisAgent-DocsIndexer/0.1' },
        redirect: 'follow'
      });
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.includes('html')) return null;
      return await response.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readMeta(id: string): Promise<SiteMeta | null> {
    try {
      const raw = await fs.readFile(path.join(this.siteDir(id), 'meta.json'), 'utf-8');
      return JSON.parse(raw) as SiteMeta;
    } catch {
      return null;
    }
  }

  /** Ré-hydrate l'index en mémoire depuis le cache disque des sites activés. */
  public async loadFromCache(sites: DocSite[]): Promise<void> {
    for (const site of sites) {
      if (!site.enabled) continue;
      const meta = await this.readMeta(site.id);
      if (!meta) continue;
      this.index.removeByPrefix(this.indexPrefix(site.id));
      for (const page of meta.pages) {
        try {
          const text = await fs.readFile(path.join(this.siteDir(site.id), 'pages', page.file), 'utf-8');
          this.index.addDocument(this.indexPrefix(site.id) + page.url, text);
        } catch {
          /* page manquante — ignorée */
        }
      }
    }
  }

  /** Retire un site de l'index en mémoire (le cache disque reste). */
  public unloadSite(id: string): void {
    this.index.removeByPrefix(this.indexPrefix(id));
  }

  /** Supprime un site : index en mémoire + cache disque. */
  public async removeSite(id: string): Promise<void> {
    this.unloadSite(id);
    await fs.rm(this.siteDir(id), { recursive: true, force: true });
  }

  public async getSiteStatuses(sites: DocSite[]): Promise<DocsSiteStatus[]> {
    const statuses: DocsSiteStatus[] = [];
    for (const site of sites) {
      const meta = await this.readMeta(site.id);
      statuses.push({
        id: site.id,
        pages: meta?.pages.length ?? 0,
        indexedAt: meta?.indexedAt
      });
    }
    return statuses;
  }

  public search(query: string, topK = 5): RagSearchResult[] {
    return this.index.search(query, topK);
  }
}
