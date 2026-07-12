# Jarvis Agent - Backend

This README describes the backend architecture of the Jarvis Agent extension (extension host, `tsc` → `dist/extension.js`). For a more detailed view geared toward development with Claude Code, see `CLAUDE.md` at the repository root — this file is deliberately kept shorter and onboarding-oriented.

## Purpose

The backend runs in VS Code's "extension host" process. It handles chat routing, the agentic loop (tools, HITL, checkpoints), model providers, RAG indexing, and all communication with the webview (frontend).

## Structure

### `src/extension.ts`

Extension entry point (`activate`/`deactivate`).
- Instantiates `JarvisExtension` and registers the VS Code commands: `jarvis.startChat`, `jarvis.rollback`, `jarvis.listCheckpoints`, `jarvis.exportAnalytics`, `jarvis.generateJarvisignore`, `jarvis.addToJarvisignore`, `jarvis.removeFromJarvisignore`, `jarvis.indexWorkspace`, `jarvis.inlineEdit` (Cmd+K), `jarvis.init` (generates `JARVIS.md`).
- Registers the inline autocomplete `InlineCompletionItemProvider` (`core/autocomplete/`), gated by `jarvis.autocomplete.enabled` (disabled by default).
- Generates `.jarvisignore` in the background on startup if it's missing.

### `src/backend/core/extension.ts`

The core of the extension: two classes.
- `JarvisSidebarProvider` (`WebviewViewProvider`) — manages the webview, routes `chatMessage`/`updateSettings`/etc. messages, drives the agentic loop (`runAgent`, `runWorkflow`, `runTDD`, `runInit`), and assembles the system prompt (`getPromptExtras` = `JARVIS.md` + rules + workspace profile + verbosity).
- `JarvisExtension` — thin wrapper around the provider, called from `src/extension.ts` (status bar, logging, session checkpoint, watchers).

### `src/backend/core/agent/` — agentic loop

- `orchestrator.ts` — `AgentOrchestrator`: the JSON-protocol loop (`{"thought","action"}` / `{"thought","final"}`), HITL gating, edited-file tracking (`ChangeTracker`), events (`AgentEvents.onToolCall/onToolResult/onFileEdited/onTodoUpdate`).
- `tool-registry.ts` — `ToolRegistry` + `createBuiltinTools()`: all the built-in tools (files, terminal, git, web search, `update_todo_list`). Each tool has an `origin` (`builtin`/`custom`/`mcp`); `restrictTo()` never filters out MCP/custom tools.
- `todo.ts` — the `TodoItem` type + validation, shared between the tool and the orchestrator.
- `custom-tools.ts` — loading of user tools from `<workspace>/jarvis-tools/*.json`.
- `autocomplete/` — `provider.ts` (`InlineCompletionItemProvider`, debounce + cancellation) and `prompt.ts` (prompt building, pure/testable without vscode).
- `utils/` — `sandbox.ts` (`SandboxManager`, workspace confinement + `.jarvisignore`), `scrubber.ts` (`SecretScrubber`, cloud providers only), `json-cleaner.ts` (robust JSON extraction), `glob.ts` (`globToRegex`, shared by `grep_search`/`file_glob_search`/scoped rules).

### `src/backend/core/mcp/`

- `client.ts` / `manager.ts` — MCP client (`@modelcontextprotocol/sdk`), connects to configured servers (Settings > MCP) and to the builtins.
- `builtin.ts` — built-in MCP servers (git, filesystem, in-process fetch, memory).
- `tools/` — concrete implementations: `fileSystem.ts` (read/write/edit/list, sandboxed), `terminal.ts` (`executeTerminalCommand`), `git.ts` (status/diff/log), `webSearch.ts` (DuckDuckGo, free, no API key).

### `src/backend/config/`

- `config-manager.ts` — types (`JarvisConfig`, `ModelItem`, `RuleItem`, `SpecializedAgent`, `Workflow`, `WebSearchConfig`, `OptimizationConfig`…) + `ConfigManager` (reads/writes `~/.jarvis/config.json` + workspace override, legacy schema migration).
- `model-config-manager.ts` — `ModelConfigManager`: instantiates one provider per enabled model, `getModelForRole(role)` (falls back to the default model for `chat`/`autocomplete`), `getContextLength()`, `isCloudProvider()`.

### `src/backend/models/`

- `abstract.ts` — `IModelProvider` interface (`sendPrompt`/`sendPromptStream`).
- `providers/` — real HTTP implementations: `ollama.ts` (NDJSON), `openrouter.ts`, `lmstudio.ts`, `mistral.ts`, `openai-compatible.ts` (shared SSE) + `openai-compatible-provider.ts` (generic wrapper for openai/anthropic/gemini/sambanova/huggingface).

### `src/backend/services/`

- `token-counter.ts`, `response-cache.ts`, `hitl.ts`, `checkpoint.ts`, `analytics.ts`, `logger.ts` — cross-cutting infrastructure (token gauge, cache, Human-in-the-Loop, git-stash checkpoints, stats, logs).
- `agents.ts` — 5 predefined `SpecializedAgent`s, each with its own `allowedToolPrefixes`.
- `workflows.ts` — `WorkflowRunner` + `TaskDecomposer` (the `dynamic` workflow).
- `rules.ts` — user rules, with optional folder scoping (glob).
- `jarvis-md.ts` — pure reader for `JARVIS.md` (the cache/watcher stay in `core/extension.ts`).
- `prompts.ts` — the `/name` prompt library.
- `tdd-loop.ts` — `AutoTDDLoop` (the Auto-TDD loop, DI-friendly).
- `background-processes.ts` — management of long-running processes (`run_in_background`).
- `context/` — `rag.ts` (in-memory index, `@xenova/transformers` embeddings), `indexer.ts` (`WorkspaceIndexer`), `pruner.ts` (AST pruning via Tree-sitter), `mentions.ts` (`@file:`/`@docs:`).

## Getting started

1. Install dependencies: `npm install`
2. Build the backend: `npm run build:extension`
3. Launch the extension in VS Code via `F5` (Extension Development Host).
4. Backend tests: `npx vitest run test/backend/` — see `CLAUDE.md` for conventions (mocking `vscode`, DI-friendly modules).

## Technical notes

- TypeScript, `Node16` (ESM) — relative imports need the `.js` suffix.
- Paths are resolved from the first workspace folder (`vscode.workspace.workspaceFolders?.[0]`).
- Main dependencies: `@modelcontextprotocol/sdk` (MCP), `@xenova/transformers` (RAG embeddings), `web-tree-sitter` (AST), `ignore` (`.jarvisignore`).
