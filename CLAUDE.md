# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Jarvis Agent** is a VS Code extension that embeds an agentic AI coding assistant. It uses a dual build pipeline: TypeScript (tsc) for the extension backend and Vite + Svelte 5 for the webview frontend. The functional spec lives in `spec.md`.

## Commands

```bash
npm run build           # compile backend (tsc) + frontend (vite)
npm run build:extension # tsc only → dist/extension.js
npm run build:webview   # vite only → dist/webview/assets/
npm run watch:webview   # vite watch mode for frontend hot-reload
npm run test            # vitest run (all tests)
npm run test:watch      # vitest interactive watch
npm run test:coverage   # vitest with v8 coverage report
npm run lint            # eslint on .ts and .svelte files (.eslintrc.cjs)
npm run package         # full build + vsce package → .vsix
```

Run a single test file:
```bash
npx vitest run test/backend/orchestrator.test.ts
```

**Local development:** press `F5` in VS Code to launch the Extension Development Host with the current build.

## Architecture

### Two separate bundles

| Layer | Source | Build tool | Output |
|---|---|---|---|
| Extension host (Node.js) | `src/backend/` + `src/extension.ts` | `tsc` (Node16 ESM — relative imports need `.js` suffix) | `dist/extension.js` |
| Webview (browser) | `src/frontend/` | `vite` | `dist/webview/assets/app.js` + `app.css` |

Both must be built before running the extension. The webview bundle is loaded via `localResourceRoots` with a strict CSP nonce.

### Extension host flow

`src/extension.ts` → `JarvisExtension` (`src/backend/core/extension.ts`), which registers the sidebar webview (`JarvisSidebarProvider`), the status bar token gauge, an OutputChannel bound to `operationLogger`, a session git checkpoint, and the commands: `startChat`, `rollback`, `listCheckpoints`, `exportAnalytics`, `generateJarvisignore`, `addToJarvisignore`, `removeFromJarvisignore`, `indexWorkspace`.

### Chat message routing (JarvisSidebarProvider.onChatMessage)

1. `@read/@list/@write/@run` → deterministic tool commands (no model)
2. `@file:<path>` / `@docs:<query>` mentions expanded via `services/context/mentions.ts` (docs backed by the RAG index)
3. `/tdd <task>` → `AutoTDDLoop` (`services/tdd-loop.ts`): generate → write → run tests → fix, max 5 attempts, timeout doubling
4. `/workflow <id> <task>` → `WorkflowRunner` (`services/workflows.ts`): 5 predefined sequential workflows (dev-feature, bug-fix, code-review, refactor, setup-project)
5. `/agent <task>` or `@QA-Agent`/`@Doc-Agent`/`@Refactor-Agent`/`@Security-Agent`/`@Perf-Agent` mention (`services/agents.ts`) → `AgentOrchestrator`
6. otherwise → streaming chat with `ResponseCache` and agent suggestion

### Agentic core (`src/backend/core/agent/`)

- `orchestrator.ts` — JSON-protocol tool loop: model replies `{"thought", "action": {"tool", "args"}}` or `{"thought", "final"}`; orchestrator executes tools (HITL-gated, scrubbed for cloud), feeds results back, max iterations configurable (`jarvis.agent.maxIterations`).
- `tool-registry.ts` — built-in tools (read_file, create_new_file, edit_existing_file, ls, file_glob_search, run_terminal_command, view_diff, git_status, git_log, search_web), each with an `hitlAction` mapping.
- `custom-tools.ts` — user tools loaded from `<workspace>/jarvis-tools/*.json` (`{name, description, parameters, command}` with `{param}` placeholders, shell-metachar sanitized, always HITL `terminal`).
- `core/utils/json-cleaner.ts` — robust JSON extraction from small-model output (fences, `<thinking>`, balanced braces, trailing commas). Use `extractJson<T>()` for anything model-generated.

### Services (`src/backend/services/`)

- `token-counter.ts` — bidirectional session counter, last-5-request history, green/orange/red thresholds; feeds webview gauge and status bar.
- `response-cache.ts` — LRU + TTL keyed on model+messages.
- `hitl.ts` — 3 modes (strict/moderate/free), session allowances, dangerous-pattern lists.
- `checkpoint.ts` — git-stash "time travel" checkpoints (action/workflow/session/manual).
- `analytics.ts` — stats persisted in `.vscode/jarvis-stats.json`.
- `logger.ts` — `operationLogger` singleton; every tool call/security event goes through it.
- `context/rag.ts` + `indexer.ts` — local TF-IDF chunk index over sandbox-allowed files (background-indexed on webview ready).
- `context/pruner.ts` — regex/indentation-based function/class/module context pruning with auto level selection.

### Security (`src/backend/core/utils/`)

- `sandbox.ts` — `SandboxManager`: workspace confinement, `.jarvisignore` patterns (incl. `!negations`), symlink detection, pattern add/remove/regenerate. `fileSystem.ts` tools all go through it (`setSandbox()` to reset after changes).
- `scrubber.ts` — `SecretScrubber`; applied to outgoing prompts **only for cloud providers** (`ModelConfigManager.isCloudProvider`).

### Model providers

`IModelProvider` (`src/backend/models/abstract.ts`): `{ name, sendPrompt(messages), sendPromptStream(messages, onChunk, onDone, onError) }`. Real HTTP implementations in `src/backend/models/providers/`: `ollama` (NDJSON stream), `openrouter`, `lmstudio`, `mistral` (all OpenAI-compatible SSE via `openai-compatible.ts`).

`ModelConfigManager` reads `jarvis/jarvis-config.json` from the **open workspace root**, instantiates enabled providers, exposes `getDefaultModel()`, `setDefaultModel()` (persists), `getProviderNameForModel()`, `getContextLength()`.

### Webview ↔ Extension messaging

- Webview → backend: `webviewReady`, `chatMessage`, `listCheckpoints`, `rollback`, `getAnalytics`, `exportAnalytics`, `setHitlMode`, `setModel`, `indexWorkspace`
- Backend → webview: `status` (+ models list), `tokens` (+ `usage` object), `chatStart/chatChunk/chatDone/chatError`, `terminalOutput`, `agentThinking`, `agentTool`, `agentToolResult`, `agentFinal`, `workflowStep`, `checkpoints`, `analytics`

### Frontend (Svelte 5, runes mode)

`App.svelte` composes `Sidebar` (tabs: chat/checkpoints/analytics, HITL mode select, thinking toggle), `ChatPanel` (marked rendering, `<thinking>` collapsibles, badges, click-to-copy code blocks), `TokenGauge` (input/output split + history), `CheckpointPanel`, `AnalyticsPanel` (CSS-bar charts). Styles use VS Code CSS variables for theme compatibility.

## Testing

Tests live in `test/` (vitest, node env). `vscode` is mocked per-file with `vi.mock('vscode', ...)`. New backend modules are dependency-injected (e.g. `AutoTDDLoop` takes `{writeFile, runCommand}`) so they test without VS Code.

## Configuration

- `jarvis/jarvis-config.json` (workspace) — providers (ollama/openrouter/lmstudio/mistral), `baseUrl`, `apiKey`, models with `contextLength`.
- VS Code settings: `jarvis.hitl.mode`, `jarvis.agent.maxIterations`, `jarvis.tdd.maxAttempts`, `jarvis.tdd.testCommand`, `jarvis.terminal.timeout`.
- `jarvis-tools/*.json` (workspace) — custom MCP-style tools.
- `.jarvisignore` (workspace) — auto-generated, stricter than `.gitignore`.
