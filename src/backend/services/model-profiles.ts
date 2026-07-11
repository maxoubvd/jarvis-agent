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
