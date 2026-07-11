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

`src/extension.ts` → `JarvisExtension` (`src/backend/core/extension.ts`), which registers the sidebar webview (`JarvisSidebarProvider`), the status bar token gauge, an OutputChannel bound to `operationLogger`, a session git checkpoint, a `jarvis.autocomplete.enabled`-gated `InlineCompletionItemProvider`, and the commands: `startChat`, `rollback`, `listCheckpoints`, `exportAnalytics`, `generateJarvisignore`, `addToJarvisignore`, `removeFromJarvisignore`, `indexWorkspace`, `inlineEdit`, `init`.

### Chat message routing (JarvisSidebarProvider.onChatMessage)

1. `@read/@list/@write/@run` → deterministic tool commands (no model)
2. `@file:<path>` / `@docs:<query>` mentions expanded via `services/context/mentions.ts` (docs backed by the RAG index)
3. `/init` → `runInit()`: `git init` if needed (confirm dialog, `ensureGitInitialized`), then an agent pass that analyzes the project and writes `JARVIS.md` at the workspace root
4. `/tdd <task>` → `AutoTDDLoop` (`services/tdd-loop.ts`): generate → write → run tests → fix, max 5 attempts, timeout doubling
5. `/workflow <id> <task>` → `WorkflowRunner` (`services/workflows.ts`): 5 predefined sequential workflows (dev-feature, bug-fix, code-review, refactor, setup-project) + `dynamic` (auto-decomposed)
6. `/agent <task>` or `@QA-Agent`/`@Doc-Agent`/`@Refactor-Agent`/`@Security-Agent`/`@Perf-Agent` mention (`services/agents.ts`) → `AgentOrchestrator`, tool registry restricted per persona (`SpecializedAgent.allowedToolPrefixes`)
7. otherwise → streaming chat with `ResponseCache` and agent suggestion

### Agentic core (`src/backend/core/agent/`)

- `orchestrator.ts` — JSON-protocol tool loop: model replies `{"thought", "action": {"tool", "args"}}` or `{"thought", "final"}`; orchestrator executes tools (HITL-gated, scrubbed for cloud), feeds results back, max iterations configurable (`jarvis.agent.maxIterations`). `AgentEvents.onFileEdited`/`onTodoUpdate` fire after a tracked file edit / an `update_todo_list` call respectively.
- `tool-registry.ts` — built-in tools: `read_file`, `create_new_file`, `edit_existing_file`, `single_find_and_replace`, `read_currently_open_file`, `grep_search`, `ls`, `file_glob_search`, `run_terminal_command`, `run_in_background`, `check_background_process`, `stop_background_process`, `view_diff`, `git_status`, `git_log`, `search_web` (Brave Search API, `sites` param), `update_todo_list` (drives the TODO checklist above the chat input). Each `ToolDefinition` carries a `hitlAction` and an `origin` (`builtin`/`custom`/`mcp`) — `restrictTo(prefixes)` only ever prunes `builtin` tools, never MCP/custom ones.
- `todo.ts` — `TodoItem`/`sanitizeTodoItems()`, shared between the tool and the orchestrator (kept out of `orchestrator.ts` to avoid a circular import with `tool-registry.ts`).
- `custom-tools.ts` — user tools loaded from `<workspace>/jarvis-tools/*.json` (`{name, description, parameters, command}` with `{param}` placeholders, shell-metachar sanitized, always HITL `terminal`).
- `core/utils/json-cleaner.ts` — robust JSON extraction from small-model output (fences, `<thinking>`, balanced braces, trailing commas). Use `extractJson<T>()` for anything model-generated.
- `core/utils/glob.ts` — `globToRegex()`, the single glob→RegExp implementation shared by `grep_search`/`file_glob_search` and the folder-scoped rules matcher (`services/rules.ts`).
- `core/autocomplete/` — inline completion (Tab / ghost text): `provider.ts` (`JarvisInlineCompletionProvider`, DI'd via `{getModel, isEnabled, isSandboxed}`, debounced + cancellable, one non-agentic `sendPrompt` call) and `prompt.ts` (pure prefix/suffix prompt builder + response cleanup, no vscode dependency).

### Services (`src/backend/services/`)

- `token-counter.ts` — bidirectional session counter, last-5-request history, green/orange/red thresholds; feeds webview gauge and status bar.
- `response-cache.ts` — LRU + TTL keyed on model+messages.
- `hitl.ts` — 3 modes (strict/moderate/free), session allowances, dangerous-pattern lists.
- `checkpoint.ts` — git-stash "time travel" checkpoints (action/workflow/session/manual).
- `analytics.ts` — stats persisted in `.vscode/jarvis-stats.json`.
- `logger.ts` — `operationLogger` singleton; every tool call/security event goes through it.
- `agents.ts` — 5 predefined `SpecializedAgent`s (qa/doc/refactor/security/perf), each with a distinct system prompt and `allowedToolPrefixes` (e.g. Security-Agent is read-only, no terminal; Refactor-Agent gets edit + terminal to re-run tests).
- `rules.ts` — `loadRules(config, activeFilePath?)`: user rules from Settings, optionally scoped to a folder (`RuleItem.scope`, a glob matched against the active editor file — unscoped rules always apply, scoped ones only when there's an active-file match).
- `jarvis-md.ts` — pure `loadJarvisMd(readFile)`/`renderJarvisMd()`; `extension.ts` owns the cache + `**/JARVIS.md` file watcher and folds the result into `getPromptExtras()` (before `USER RULES`), so both single-agent runs and `WorkflowRunner` pick it up automatically.
- `context/rag.ts` + `indexer.ts` — local in-memory embedding index (brute-force cosine similarity over `@xenova/transformers` sentence embeddings, no external vector DB) over sandbox-allowed files (background-indexed on webview ready).
- `context/pruner.ts` — regex/indentation-based function/class/module context pruning with auto level selection.

### Security (`src/backend/core/utils/`)

- `sandbox.ts` — `SandboxManager`: workspace confinement, `.jarvisignore` patterns (incl. `!negations`), symlink detection, pattern add/remove/regenerate. `fileSystem.ts` tools all go through it (`setSandbox()` to reset after changes); the autocomplete provider also checks it (`canAccess`) before firing a completion.
- `scrubber.ts` — `SecretScrubber`; applied to outgoing prompts **only for cloud providers** (`ModelConfigManager.isCloudProvider`).

### Model providers

`IModelProvider` (`src/backend/models/abstract.ts`): `{ name, sendPrompt(messages), sendPromptStream(messages, onChunk, onDone, onError) }`. Real HTTP implementations in `src/backend/models/providers/`: `ollama` (NDJSON stream), `openrouter`, `lmstudio`, `mistral`, `openai-compatible` (generic wrapper, also covers `openai`/`anthropic`/`gemini`/`sambanova`/`huggingface`) — all OpenAI-compatible SSE via `openai-compatible.ts` except `ollama`.

`ModelConfigManager` (`src/backend/config/model-config-manager.ts`) instantiates one provider per enabled `ModelItem`, exposes `getDefaultModel()`, `setDefaultModel()` (persists), `getProviderNameForModel()`, `getContextLength()`, and `getModelForRole(role)` — returns the first model explicitly tagged with that role, falling back to the effective chat model for `'chat'` **and** `'autocomplete'` (so autocomplete works even with no model explicitly tagged).

### Webview ↔ Extension messaging

- Webview → backend: `webviewReady`, `chatMessage`, `listCheckpoints`, `rollback`, `getAnalytics`, `exportAnalytics`, `setHitlMode` (instant switch, decoupled from the full Settings save), `setModel`, `indexWorkspace`, `requestGitInit`
- Backend → webview: `status` (+ models list), `tokens` (+ `usage` object), `chatStart/chatChunk/chatDone/chatError`, `terminalOutput`, `agentThinking`, `agentTool`, `agentToolResult`, `agentFinal`, `workflowStep`, `todoUpdate` (+ `items: TodoItem[]`, also synthesized upfront from a workflow's known steps), `checkpoints`, `analytics`, `pendingChanges`

### Frontend (Svelte 5, runes mode)

`App.svelte` composes `Sidebar` (tabs: chat/checkpoints/analytics/settings), `ChatPanel` (marked rendering, `<thinking>` collapsibles, badges, click-to-copy code blocks, `TodoList` above the input, empty-state New/Resume actions), `TokenGauge` (input/output split + history), `CheckpointPanel`, `AnalyticsPanel` (CSS-bar charts — no charting library), `SettingsPanel` (composed of per-section components: `ModelsSection`, `AgentsSection`, `WebSearchSection`, `McpSection`, `WorkflowsSection`, `PromptsSection`, `DocsSection`, `WorkspacesSection`). Styles use VS Code CSS variables for theme compatibility. `src/frontend/shared/types.ts` is a **hand-maintained mirror** of the backend config types (`config-manager.ts`) — keep both in sync when adding a config field.

## Testing

Tests live in `test/` (vitest, node env for `test/backend/`, `happy-dom` + `@testing-library/svelte` for `test/frontend/`). `vscode` is mocked per-file with `vi.mock('vscode', ...)`. New backend modules are dependency-injected (e.g. `AutoTDDLoop` takes `{writeFile, runCommand}`, `jarvis-md.ts`'s `loadJarvisMd` takes a `readFile` function) so they test without VS Code. Frontend component tests mount the real `App.svelte` via `@testing-library/svelte` and drive it with `window.dispatchEvent(new MessageEvent('message', { data }))` to simulate backend→webview messages (see `test/frontend/approval-diff-review.test.ts`, `test/frontend/todo-list.test.ts`).

## Configuration

- `~/.jarvis/config.json` (global) + `<workspace>/jarvis/jarvis-config.json` (workspace override, deep-merged) — model-centric schema: `models.items: ModelItem[]` (`provider`, `apiKey`/`apiBase`, `roles`, `contextLength`), `rules` (with optional `scope` glob), `agents`, `workflows`, `prompts`, `webSearch` (`{provider: 'brave', apiKey, defaultSites}`), `optimization` (hitl/chat/verbosity/auto-open/autocomplete settings).
- `<workspace>/JARVIS.md` — optional project-instructions file (à la `CLAUDE.md`), read/cached/watched and injected into every agent/workflow/chat system prompt. Generated (or regenerated, with a confirm dialog) by `/init`.
- VS Code settings: `jarvis.hitl.mode`, `jarvis.agent.maxIterations`, `jarvis.tdd.maxAttempts`, `jarvis.tdd.testCommand`, `jarvis.terminal.timeout`, `jarvis.autoOpen.mode` (`always`/`never`/`strict-hitl-only`), `jarvis.autocomplete.enabled` (default `false`).
- `jarvis-tools/*.json` (workspace) — custom MCP-style tools.
- `.jarvisignore` (workspace) — auto-generated, stricter than `.gitignore`.
