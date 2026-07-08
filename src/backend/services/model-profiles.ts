import type { ModelItem } from '../config/config-manager.js';

/**
 * Profils d'optimisation par famille de modèle (spec §7 — petits modèles) :
 * température recommandée par l'éditeur du modèle et style de prompt agentique
 * adapté. `ModelItem.temperature` (Settings) surcharge toujours le profil.
 *
 * Sources : Devstral (Mistral) recommande T° 0.0–0.15 et un prompt « agentic
 * scaffold » ; Qwen2.5-Coder produit un JSON fiable à basse température.
 */
export interface ModelProfile {
  id: 'devstral' | 'codestral' | 'qwen-coder';
  match: RegExp;
  temperature: number;
  /**
   * - `agentic-rich` : persona renforcée orientée agent (grands modèles code) ;
   * - `compact-json` : prompt resserré + few-shot supplémentaire (petits modèles locaux).
   */
  promptStyle: 'agentic-rich' | 'compact-json';
  /** Ajout à la persona du prompt système de l'agent. */
  personaExtra?: string;
  /** Troncature des résultats d'outils (petits contextes). */
  maxToolResultChars?: number;
}

const PROFILES: ModelProfile[] = [
  {
    id: 'devstral',
    match: /devstral/i,
    temperature: 0.1,
    promptStyle: 'agentic-rich',
    personaExtra:
      'Tu es un agent d\'ingénierie logicielle : méthodique et exhaustif, tu privilégies la qualité à la vitesse. ' +
      'Tu explores le code avec tes outils avant de modifier, tu vérifies chaque changement, et tu itères jusqu\'à ce que la tâche soit réellement terminée.'
  },
  {
    id: 'codestral',
    match: /codestral/i,
    temperature: 0.1,
    promptStyle: 'agentic-rich'
  },
  {
    id: 'qwen-coder',
    match: /qwen[^a-z0-9]*(2\.5|3)?[^a-z0-9]*coder|coder[^a-z0-9]*qwen/i,
    temperature: 0.15,
    promptStyle: 'compact-json',
    maxToolResultChars: 4000
  }
];

/**
 * Fenêtres de contexte par famille de modèle, utilisées uniquement quand
 * `ModelItem.contextLength` n'est pas défini dans jarvis-config.json (la config
 * gagne toujours). Valeurs volontairement conservatrices : la plus petite
 * variante courante de la famille (ex. codestral-22b local = 32k, alors que
 * codestral-2501 via l'API Mistral monte à 256k → à surcharger en config).
 * Indépendante de `PROFILES` : un défaut de contexte ne doit pas impliquer
 * une température ou un style de prompt.
 */
const CONTEXT_LENGTH_DEFAULTS: Array<{ match: RegExp; tokens: number }> = [
  // `devstral` avant les patterns mistral génériques (premier match gagne).
  { match: /devstral/i, tokens: 128_000 },
  { match: /codestral/i, tokens: 32_768 },
  { match: /qwen[^a-z0-9]*(2\.5|3)?[^a-z0-9]*coder|coder[^a-z0-9]*qwen/i, tokens: 32_768 },
  { match: /mistral[-_ ]?large/i, tokens: 128_000 },
  { match: /mistral[-_ ]?small|ministral/i, tokens: 32_768 },
  { match: /deepseek[^a-z0-9]*coder/i, tokens: 16_384 },
  { match: /llama[-_ ]?3/i, tokens: 8_192 }
];

/** Fenêtre de contexte par défaut pour la famille du modèle, sinon `null`. */
export function defaultContextLength(
  item: Pick<ModelItem, 'model' | 'name'> | null | undefined
): number | null {
  if (!item) return null;
  const haystack = `${item.model} ${item.name}`;
  return CONTEXT_LENGTH_DEFAULTS.find(d => d.match.test(haystack))?.tokens ?? null;
}

/** Profil correspondant au modèle (id API ou nom d'affichage), sinon `null`. */
export function resolveProfile(item: Pick<ModelItem, 'model' | 'name'> | null | undefined): ModelProfile | null {
  if (!item) return null;
  const haystack = `${item.model} ${item.name}`;
  return PROFILES.find(p => p.match.test(haystack)) ?? null;
}

/** Température effective : réglage utilisateur > profil > aucune (défaut API). */
export function effectiveTemperature(
  item: Pick<ModelItem, 'model' | 'name' | 'temperature'> | null | undefined
): number | undefined {
  if (!item) return undefined;
  if (typeof item.temperature === 'number') return item.temperature;
  return resolveProfile(item)?.temperature;
}
