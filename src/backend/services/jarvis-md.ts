/**
 * Project instructions file `JARVIS.md` (CLAUDE.md-style), read from the
 * workspace root and injected into the system prompt alongside the rules and
 * the active workspace profile (see `getPromptExtras` in extension.ts). Unlike
 * rules, it's versioned with the code — shared across team members.
 * Pure (no vscode) — testable; the actual reading/cache/watcher stay in extension.ts.
 */

/** Reads `JARVIS.md` via the provided read function (sandboxed by the caller). Empty if missing. */
export async function loadJarvisMd(readFile: (path: string) => Promise<string>): Promise<string> {
  try {
    const content = await readFile('JARVIS.md');
    return content.trim();
  } catch {
    return '';
  }
}

/** Project instructions block injected into the system prompt (renderRules-style). */
export function renderJarvisMd(content: string): string {
  if (!content.trim()) return '';
  return `PROJECT INSTRUCTIONS (JARVIS.md):\n${content.trim()}`;
}
