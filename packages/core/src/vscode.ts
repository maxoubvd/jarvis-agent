/**
 * @jarvis/core/vscode — the vscode-coupled host classes.
 *
 * Imported ONLY by the VS Code extension entry (`src/extension.ts`). Keeping these
 * behind a separate entry ensures `@jarvis/core` (the main barrel) stays free of any
 * `vscode` import, so the Jarvis CLI can bundle the engine without pulling vscode in.
 */
export { JarvisExtension } from './core/extension.js';
export { JarvisInlineCompletionProvider } from './core/autocomplete/provider.js';
