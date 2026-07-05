# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Jarvis Agent** is a VS Code extension that embeds an agentic AI coding assistant. It uses a dual build pipeline: TypeScript (tsc) for the extension backend and Vite + Svelte 5 for the webview frontend.

## Commands

```bash
npm run build           # compile backend (tsc) + frontend (vite)
npm run build:extension # tsc only → dist/extension.js
npm run build:webview   # vite only → dist/webview/assets/
npm run watch:webview   # vite watch mode for frontend hot-reload
npm run test            # vitest run (all tests)
npm run test:watch      # vitest interactive watch
npm run test:coverage   # vitest with v8 coverage report
npm run lint            # eslint on .ts and .svelte files
npm run package         # full build + vsce package → .vsix
```

Run a single test file:
```bash
npx vitest run src/path/to/file.test.ts
```

**Local development:** press `F5` in VS Code to launch the Extension Development Host with the current build.

## Architecture

### Two separate bundles

| Layer | Source | Build tool | Output |
|---|---|---|---|
| Extension host (Node.js) | `src/backend/` + `src/extension.ts` | `tsc` | `dist/extension.js` |
| Webview (browser) | `src/frontend/` | `vite` | `dist/webview/assets/app.js` + `app.css` |

Both must be built before running the extension. The webview bundle is loaded via `localResourceRoots` with a strict CSP nonce.

### Extension host flow

`src/extension.ts` (VS Code entry point) → instantiates `JarvisExtension` (`src/backend/core/extension.ts`), which:
- Creates the status bar item (`$(hubot) Jarvis`)
- Registers commands: `jarvis.startChat`, `jarvis.rollback`, `jarvis.listCheckpoints`, `jarvis.exportAnalytics`
- On `startChat`: creates a `WebviewPanel` and injects the Svelte bundle HTML
- Reads model config via `ModelConfigManager` (`src/backend/config/model-config-manager.ts`), which loads `jarvis/jarvis-config.json` from the **open workspace root** (not the extension root)

### Webview ↔ Extension messaging

- Backend → webview: `panel.webview.postMessage({ type, ... })`
- Webview → backend: `vscode.postMessage({ type, ... })` (via `acquireVsCodeApi()`)
- Message types: `webviewReady`, `status`, `tokens`, `chatMessage`
- The webview fires `webviewReady` on mount; the backend responds with the active model and token count

### Model providers

`IModelProvider` (`src/backend/models/abstract.ts`) defines the interface: `{ name, sendPrompt(prompt) }`.

Three providers exist in `src/backend/models/providers/`, all currently stubbed with simulated responses:
- `OllamaProvider` — local, `http://localhost:11434`
- `OpenRouterProvider` — cloud, requires `apiKey`
- `LMStudioProvider` — local, `http://localhost:1234/v1`

`ModelConfigManager` reads `jarvis/jarvis-config.json`, instantiates only the providers with `"enabled": true`, and exposes `getDefaultModel()`, `getAvailableModels()`, `getProvider(name)`.

### MCP layer

`src/backend/core/mcp/` wraps `@modelcontextprotocol/sdk`. Tools in `src/backend/core/mcp/tools/`:
- `fileSystem.ts` — `readFileTool` / `writeFileTool`, enforces workspace path confinement via `assertPathWithinWorkspace`
- `git.ts` — runs git commands via a VS Code terminal
- `terminal.ts`, `webSearch.ts` — stubs

### Frontend (Svelte 5, runes mode)

`src/frontend/main.ts` mounts `App.svelte` and wires up the VS Code message bus. `App.svelte` composes three components: `Sidebar`, `ChatPanel`, `TokenGauge`. State uses Svelte 5 `$state` runes. Styles use VS Code CSS variables (`--vscode-editor-foreground`, etc.) for theme compatibility.

## Configuration

`jarvis/jarvis-config.json` (in the **workspace**, not the extension directory) controls which providers are active, their `baseUrl`, `apiKey`, and available models with `contextLength`.

## Status of features

- `rollback`, `listCheckpoints` → Phase 2 (not implemented, show info message)
- `exportAnalytics` → Phase 4 (not implemented)
- All model providers return simulated responses (real HTTP calls not yet wired)
