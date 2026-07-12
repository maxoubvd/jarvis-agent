import type { ModelItem } from '../config/config-manager.js';

/**
 * Optimization profiles per model family (spec §7 — small models):
 * temperature recommended by the model's publisher and a matching agentic
 * prompt style. `ModelItem.temperature` (Settings) always overrides the profile.
 *
 * Sources: Devstral (Mistral) recommends a temperature of 0.0–0.15 and an
 * "agentic scaffold" prompt; Qwen2.5-Coder produces reliable JSON at low temperature.
 */
export interface ModelProfile {
  id: 'devstral' | 'codestral' | 'qwen-coder';
  match: RegExp;
  temperature: number;
  /**
   * - `agentic-rich`: reinforced agent-oriented persona (large code models);
   * - `compact-json`: tightened prompt + extra few-shot examples (small local models).
   */
  promptStyle: 'agentic-rich' | 'compact-json';
  /** Addition to the agent's system prompt persona. */
  personaExtra?: string;
  /** Truncation of tool results (small contexts). */
  maxToolResultChars?: number;
}

const PROFILES: ModelProfile[] = [
  {
    id: 'devstral',
    match: /devstral/i,
    temperature: 0.1,
    promptStyle: 'agentic-rich',
    personaExtra:
      'You are a software engineering agent: methodical and thorough, favoring quality over speed. ' +
      'You explore the code with your tools before making changes, verify every change, and iterate until the task is truly complete.'
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

/** Profile matching the model (API id or display name), otherwise `null`. */
export function resolveProfile(item: Pick<ModelItem, 'model' | 'name'> | null | undefined): ModelProfile | null {
  if (!item) return null;
  const haystack = `${item.model} ${item.name}`;
  return PROFILES.find(p => p.match.test(haystack)) ?? null;
}

/** Effective temperature: user setting > profile > none (API default). */
export function effectiveTemperature(
  item: Pick<ModelItem, 'model' | 'name' | 'temperature'> | null | undefined
): number | undefined {
  if (!item) return undefined;
  if (typeof item.temperature === 'number') return item.temperature;
  return resolveProfile(item)?.temperature;
}
