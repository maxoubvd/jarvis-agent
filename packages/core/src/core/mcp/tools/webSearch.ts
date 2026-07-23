import { getConfigManager, DEFAULT_WEB_SEARCH_SITES } from '../../../config/config-manager.js';

export interface WebSearchOptions {
  /** Domains explicitly requested by the model (takes precedence over `defaultSites` from config). */
  sites?: string[];
}

interface ParsedResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Web search via the public HTML endpoint of DuckDuckGo (`html.duckduckgo.com`) —
 * no API key, no account, entirely free. There is no official JSON API
 * for this endpoint: we parse the results page with targeted regexes on its stable
 * structure (`result__a` / `result__snippet`), as equivalent libraries do
 * (duckduckgo-search, langchain).
 * `sites` (from the model) or `webSearch.defaultSites` (user setting, applied
 * only if the model hasn't specified any — which itself falls back on
 * `DEFAULT_WEB_SEARCH_SITES` until the user has ever saved Settings > Web Search)
 * are translated into `site:` OR operators.
 */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<string> {
  const cfg = getConfigManager().getConfig().webSearch;
  const sites = options.sites?.length ? options.sites : (cfg?.defaultSites ?? DEFAULT_WEB_SEARCH_SITES);
  const effectiveQuery = sites?.length ? `${query} (${sites.map(s => `site:${s}`).join(' OR ')})` : query;

  let res: Response;
  try {
    res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(effectiveQuery)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; JarvisAgent/1.0; +https://code.visualstudio.com/)',
        Accept: 'text/html'
      }
    });
  } catch (err) {
    return `Error: web search failed (${err instanceof Error ? err.message : String(err)}).`;
  }

  if (!res.ok) {
    return `Error: web search failed (HTTP ${res.status}).`;
  }

  const results = parseResults(await res.text()).slice(0, 6);
  if (results.length === 0) return '(no results)';

  return results.map(r => `- [${r.title}](${r.url}): ${r.snippet}`).join('\n');
}

function parseResults(html: string): ParsedResult[] {
  const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;

  const titles: { url: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = titleRe.exec(html)) !== null) {
    titles.push({ url: resolveDdgUrl(m[1]), title: stripHtml(m[2]) });
  }

  const snippets: string[] = [];
  while ((m = snippetRe.exec(html)) !== null) {
    snippets.push(stripHtml(m[1]));
  }

  return titles.map((t, i) => ({ title: t.title, url: t.url, snippet: snippets[i] ?? '' }));
}

/** DuckDuckGo returns redirect links `//duckduckgo.com/l/?uddg=<encoded url>&...`. */
function resolveDdgUrl(href: string): string {
  const absolute = href.startsWith('//') ? `https:${href}` : href;
  try {
    const uddg = new URL(absolute, 'https://duckduckgo.com').searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : absolute;
  } catch {
    return absolute;
  }
}

function stripHtml(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}
