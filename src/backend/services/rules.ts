import type { JarvisConfig, RuleItem } from '../config/config-manager.js';
import { globToRegex } from '../core/utils/glob.js';

/**
 * User rules enabled from the config (Settings tab).
 * `activeFilePath` (path relative to the workspace) filters rules
 * scoped to a folder (`scope`, glob): a scoped rule only applies if the
 * active file matches it; an unscoped rule always applies. Without
 * `activeFilePath` (no active file — e.g. workflow run), only
 * unscoped rules apply.
 */
export function loadRules(config: JarvisConfig, activeFilePath?: string | null): RuleItem[] {
  return (config.rules ?? []).filter(r => {
    if (!r.enabled || r.content.trim().length === 0) return false;
    if (!r.scope) return true;
    return !!activeFilePath && globToRegex(r.scope).test(activeFilePath);
  });
}

/** Concatenates rules into a block injectable into system prompts. */
export function renderRules(rules: RuleItem[]): string {
  if (rules.length === 0) return '';
  const body = rules.map(r => `- ${r.content.trim()}`).join('\n');
  return `USER RULES (always follow these):\n${body}`;
}
