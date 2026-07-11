/**
 * Fichier d'instructions projet `JARVIS.md` (façon CLAUDE.md), lu à la racine du
 * workspace et injecté dans le prompt système au même titre que les rules et le
 * profil de workspace actif (cf. `getPromptExtras` dans extension.ts). Contrairement
 * aux rules, versionné avec le code — partagé entre membres d'une équipe.
 * Pur (pas de vscode) — testable ; la lecture réelle/le cache/le watcher restent côté extension.ts.
 */

/** Lit `JARVIS.md` via la fonction de lecture fournie (sandboxée côté appelant). Vide si absent. */
export async function loadJarvisMd(readFile: (path: string) => Promise<string>): Promise<string> {
  try {
    const content = await readFile('JARVIS.md');
    return content.trim();
  } catch {
    return '';
  }
}

/** Bloc d'instructions projet injecté dans le prompt système (style renderRules). */
export function renderJarvisMd(content: string): string {
  if (!content.trim()) return '';
  return `PROJECT INSTRUCTIONS (JARVIS.md):\n${content.trim()}`;
}
