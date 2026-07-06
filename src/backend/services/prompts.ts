import type { JarvisConfig, PromptItem } from '../config/config-manager.js';

/** Commandes slash du chat qui ne peuvent pas être masquées par un prompt. */
export const RESERVED_SLASH_COMMANDS = new Set(['tdd', 'workflow', 'agent']);

/** Nom canonique d'un prompt : sans `/` initial, insensible à la casse. */
export function normalizePromptName(name: string): string {
  return name.trim().replace(/^\//, '').toLowerCase();
}

/** Prompts utilisables : nommés, non vides, et ne masquant pas une commande réservée. */
export function loadPrompts(config: JarvisConfig): PromptItem[] {
  return (config.prompts ?? []).filter(p => {
    const name = normalizePromptName(p.name ?? '');
    return !!name && !!p.content?.trim() && !RESERVED_SLASH_COMMANDS.has(name);
  });
}

/**
 * Développe `/nom args…` en `<contenu du prompt>\n\n<args>`.
 * Retourne `null` si le texte n'invoque aucun prompt enregistré (le routage
 * normal du chat s'applique alors).
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
