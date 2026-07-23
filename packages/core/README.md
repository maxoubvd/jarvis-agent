# @jarvis/core — Shared Jarvis engine

This package is the **host-agnostic engine** behind Jarvis Agent. It is consumed by two front-ends:
the **VS Code extension** (`src/extension.ts` + the Svelte webview, at the repo root) and the
**Jarvis CLI** (`packages/cli`). For a detailed, development-oriented view see `CLAUDE.md` at the
repository root — this file is kept shorter and onboarding-oriented.

## Purpose

Chat routing helpers, the agentic loop (tools, HITL, checkpoints), model providers, RAG indexing,
config, and all the cross-cutting services. **The public API (`src/index.ts`) never imports `vscode`**,
so the same code powers the extension host and a plain Node CLI.

## Host-agnostic seam

Instead of talking to `vscode`, the core resolves host concerns through small injectable seams:

- `core/utils/workspace.ts` → `getWorkspaceRoot()` = `process.env.JARVIS_WORKSPACE || process.cwd()`.
  The extension sets `JARVIS_WORKSPACE` at activation; the CLI runs inside the target project.
- `core/utils/event.ts` → a minimal `EventEmitter<T>` mirroring `vscode.EventEmitter` (`.event`/`.fire`).
- `tool-registry.ts` → `setActiveFileProvider(fn)` backs `read_currently_open_file` (extension = active
  editor, CLI = last `@file`).
- `hitl.ts` → `setPromptHandler` (primary) + `setFallbackHandler` (last resort). The extension wires a
  native modal; the CLI wires an inquirer prompt.
- `analytics.ts` → `export(onExported)` returns the path and lets the host surface it.

The two entry points:

- `src/index.ts` — the **vscode-free barrel** (imported by the CLI and by the extension for engine calls).
- `src/vscode.ts` — the vscode-coupled host classes (`JarvisExtension`, `JarvisInlineCompletionProvider`),
  imported **only** by `src/extension.ts`. The webview host `core/extension.ts` and the editor-UI
  providers (`codelens.ts`, `diff-decorations.ts`, `autocomplete/provider.ts`) still use `vscode`, but
  are excluded from the barrel — so nothing vscode leaks into the CLI bundle.

## Structure

### `src/core/agent/` — agentic loop

- `orchestrator.ts` — `AgentOrchestrator`: the JSON-protocol loop (`{"thought","action"}` / `{"thought","final"}`), HITL gating, edited-file tracking (`ChangeTracker`), events (`AgentEvents.onToolCall/onToolResult/onTodoUpdate`).
- `tool-registry.ts` — `ToolRegistry` + `createBuiltinTools()`: built-in tools (files, terminal, git, web search, `update_todo_list`). Each tool has an `origin` (`builtin`/`custom`/`mcp`); `restrictTo()` never filters MCP/custom tools.
- `todo.ts` — the `TodoItem` type + validation. `custom-tools.ts` — user tools from `<workspace>/jarvis-tools/*.json`.

### `src/core/mcp/`

- `client.ts` / `manager.ts` — MCP client (`@modelcontextprotocol/sdk`). `builtin.ts` — built-in MCP servers (git, filesystem, in-process fetch, memory).
- `tools/` — `fileSystem.ts` (sandboxed read/write/edit/list), `terminal.ts` (`executeTerminalCommand`), `git.ts`, `webSearch.ts` (DuckDuckGo, free).

### `src/core/utils/`

`sandbox.ts` (`SandboxManager`, workspace confinement + `.jarvisignore`), `scrubber.ts` (`SecretScrubber`, cloud only), `json-cleaner.ts`, `glob.ts`, plus the host seam (`workspace.ts`, `event.ts`).

### `src/config/`

- `config-manager.ts` — types (`JarvisConfig`, `ModelItem`, `RuleItem`, `SpecializedAgent`, `Workflow`, `OptimizationConfig`…) + `ConfigManager` (`~/.jarvis/config.json` + workspace override, legacy migration).
- `model-config-manager.ts` — `ModelConfigManager`: one provider per enabled model, `getModelForRole()`, `getContextLength()`, `isCloudProvider()`.

### `src/models/`

`abstract.ts` (`IModelProvider`) + `providers/` (`ollama` NDJSON, `openrouter`, `lmstudio`, `mistral`, `openai-compatible` shared SSE + generic wrapper for openai/anthropic/gemini/sambanova/huggingface).

### `src/services/`

`token-counter.ts`, `response-cache.ts`, `hitl.ts`, `checkpoint.ts`, `analytics.ts`, `logger.ts`, `agents.ts` (5 `SpecializedAgent`s), `workflows.ts` (+ `task-decomposer.ts`), `rules.ts`, `jarvis-md.ts`, `prompts.ts`, `tdd-loop.ts`, `background-processes.ts`, and `context/` (`rag.ts` embeddings, `indexer.ts`, `pruner.ts` Tree-sitter, `mentions.ts`).

## Getting started

1. Install from the repo root: `npm install` (npm workspaces links `@jarvis/core`).
2. Typecheck the core: `npm run typecheck:core`.
3. Tests: `npx vitest run --project backend` — see `CLAUDE.md` for conventions (DI-friendly modules, `vscode` no longer imported by the core).

## Technical notes

- TypeScript, `Node16` (ESM) — relative imports need the `.js` suffix.
- The workspace root comes from `getWorkspaceRoot()`, never from `vscode` directly.
- Main dependencies: `@modelcontextprotocol/sdk` (MCP), `@xenova/transformers` (RAG embeddings), `web-tree-sitter` (AST).
