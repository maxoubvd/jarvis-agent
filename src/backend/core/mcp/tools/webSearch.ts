import { getConfigManager } from '../../../config/config-manager.js';

export interface WebSearchOptions {
  /** Domaines explicitement demandés par le modèle (prime sur `defaultSites` de la config). */
  sites?: string[];
}

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

/**
 * Recherche web via Brave Search API. Sans clé configurée, renvoie le même message
 * d'erreur qu'avant (comportement inchangé pour les utilisateurs qui n'en ont pas).
 * `sites` (venant du modèle) ou `webSearch.defaultSites` (réglage utilisateur, appliqué
 * seulement si le modèle n'a rien précisé) sont traduits en opérateurs `site:` OR.
 */
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<string> {
  const cfg = getConfigManager().getConfig().webSearch;
  if (!cfg?.apiKey) {
    return `Erreur: Outil de recherche web non configuré. Impossible de rechercher "${query}". Demande à l'utilisateur de fournir l'information.`;
  }

  const sites = options.sites?.length ? options.sites : cfg.defaultSites;
  const effectiveQuery = sites?.length ? `${query} (${sites.map(s => `site:${s}`).join(' OR ')})` : query;

  let res: Response;
  try {
    res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(effectiveQuery)}`, {
      headers: { 'X-Subscription-Token': cfg.apiKey, Accept: 'application/json' }
    });
  } catch (err) {
    return `Erreur: recherche web échouée (${err instanceof Error ? err.message : String(err)}).`;
  }

  if (!res.ok) {
    return `Erreur: recherche web échouée (HTTP ${res.status}).`;
  }

  const data = (await res.json()) as { web?: { results?: BraveWebResult[] } };
  const results = (data.web?.results ?? []).slice(0, 6);
  if (results.length === 0) return '(aucun résultat)';

  return results
    .map(r => `- [${r.title ?? '(sans titre)'}](${r.url ?? ''}): ${r.description ?? ''}`)
    .join('\n');
}
