import type { JarvisConfig, RuleItem } from '../config/config-manager.js';
import { globToRegex } from '../core/utils/glob.js';

/**
 * Rules utilisateur activées depuis la config (onglet Settings).
 * `activeFilePath` (chemin relatif au workspace) permet de filtrer les rules
 * scopées à un dossier (`scope`, glob) : une rule scopée ne s'applique que si le
 * fichier actif la matche ; une rule non scopée s'applique toujours. Sans
 * `activeFilePath` (pas de fichier actif — ex. run de workflow), seules les
 * rules non scopées s'appliquent.
 */
export function loadRules(config: JarvisConfig, activeFilePath?: string | null): RuleItem[] {
  return (config.rules ?? []).filter(r => {
    if (!r.enabled || r.content.trim().length === 0) return false;
    if (!r.scope) return true;
    return !!activeFilePath && globToRegex(r.scope).test(activeFilePath);
  });
}

/** Concatène les rules en un bloc injectable dans les prompts système. */
export function renderRules(rules: RuleItem[]): string {
  if (rules.length === 0) return '';
  const body = rules.map(r => `- ${r.content.trim()}`).join('\n');
  return `USER RULES (à toujours respecter):\n${body}`;
}
