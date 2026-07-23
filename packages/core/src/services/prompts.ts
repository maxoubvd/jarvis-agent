import type { JarvisConfig, PromptItem } from '../config/config-manager.js';

/** Chat slash commands that cannot be shadowed by a prompt. */
export const RESERVED_SLASH_COMMANDS = new Set(['tdd', 'workflow', 'agent', 'new', 'resume', 'init']);

/** Canonical prompt name: no leading `/`, case-insensitive. */
export function normalizePromptName(name: string): string {
  return name.trim().replace(/^\//, '').toLowerCase();
}

/** Usable prompts: named, non-empty, and not shadowing a reserved command. */
export function loadPrompts(config: JarvisConfig): PromptItem[] {
  return (config.prompts ?? []).filter(p => {
    const name = normalizePromptName(p.name ?? '');
    return !!name && !!p.content?.trim() && !RESERVED_SLASH_COMMANDS.has(name);
  });
}

/**
 * Expands `/name args…` into `<prompt content>\n\n<args>`.
 * Returns `null` if the text does not invoke any registered prompt
 * (normal chat routing applies in that case).
 */
export function expandPrompt(text: string, prompts: PromptItem[]): string | null {
  const match = text.match(/^\/(\S+)\s*([\s\S]*)$/);
  if (!match) return null;
  const name = match[1].toLowerCase();
  if (RESERVED_SLASH_COMMANDS.has(name)) return null;
  const prompt = prompts.find(p => normalizePromptName(p.name) === name);
  if (!prompt) return null;
  const rest = match[2].trim();
  const content = prompt.content.trim();
  return rest ? `${content}\n\n${rest}` : content;
}
