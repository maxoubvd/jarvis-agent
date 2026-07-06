import type { JarvisConfig, RuleItem } from '../config/config-manager.js';

/** Rules utilisateur activées depuis la config (onglet Settings). */
export function loadRules(config: JarvisConfig): RuleItem[] {
  return (config.rules ?? []).filter(r => r.enabled && r.content.trim().length > 0);
}

/** Concatène les rules en un bloc injectable dans les prompts système. */
export function renderRules(rules: RuleItem[]): string {
  if (rules.length === 0) return '';
  const body = rules.map(r => `- ${r.content.trim()}`).join('\n');
  return `USER RULES (à toujours respecter):\n${body}`;
}
