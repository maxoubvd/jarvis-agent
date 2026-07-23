/**
 * Host-agnostic workspace root resolution.
 *
 * The shared core must not depend on `vscode`, yet several modules (sandbox, config
 * override, terminal cwd, tool registry, analytics) need "the current project folder".
 *
 * - **VS Code extension**: sets `process.env.JARVIS_WORKSPACE` to the active workspace
 *   folder at activation (see `src/extension.ts`).
 * - **CLI**: runs from inside the target project, so `process.cwd()` is correct.
 */
export function getWorkspaceRoot(): string {
  return process.env.JARVIS_WORKSPACE || process.cwd();
}
