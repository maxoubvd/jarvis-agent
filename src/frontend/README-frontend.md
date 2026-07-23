# Jarvis Agent - Frontend

This README describes the frontend architecture of the Jarvis Agent extension: the webview displayed in the VS Code sidebar (Svelte 5, runes mode, built by Vite → `dist/webview/assets/`).

## Purpose

The frontend displays the agentic chat, settings, checkpoints, and analytics. It communicates with the backend (extension host) only via `postMessage`/`window.addEventListener('message', ...)` — no direct access to the file system or the VS Code API (isolated by the webview sandbox).

## Structure

### `src/frontend/index.html` / `main.ts`

Entry point: mounts `App.svelte` onto `#app`.

### `src/frontend/App.svelte`

Root component — orchestrates all of the application's state (`$state`) and the switch over messages received from the backend (`onWindowMessage`). Composes:
- `Sidebar` — tab navigation (chat/checkpoints/analytics/settings).
- `ChatPanel` — main chat panel.
- `TokenGauge` — token gauge (status bar + detailed panel, history of the last 5 requests).
- `CheckpointPanel` — list of git-stash checkpoints + rollback.
- `AnalyticsPanel` — statistics (pure CSS bars, no charting library).
- `SettingsPanel` — all settings (see `components/settings/`).
- `DiffReviewPanel` — review of files modified by the agent (accept/reject per hunk).
- `WelcomeScreen` — onboarding on first launch (no model configured).

### `src/frontend/components/`

- `ChatPanel.svelte` — markdown rendering (`marked`), syntax highlighting (`prismjs`), collapsible `<thinking>` blocks, `TodoList` (persistent checklist above the input area), `/` command and `@` mention autocompletion, mode selector (Automatic/Fast/Plan) and model selector.
- `TodoList.svelte` — task checklist (`update_todo_list` / workflow summary), collapsible, pending/in_progress/completed statuses.
- `ApprovalCard.svelte` — HITL approval card displayed in the chat (allow / allow-session / deny + feedback).
- `Icon.svelte` — hand-drawn 16×16 stroke SVG icons (no external icon dependency); `PATHS` is the name → SVG path table.
- `Toggle.svelte` — "lightswitch" toggle reused across all settings.
- `SettingsPanel.svelte` — orchestrates the sections below, handles serialization to `JarvisConfig` and the "dirty"/save state.

### `src/frontend/components/settings/`

One section per configuration domain, all following the same pattern (`items`/`config` + `onChange` callback):
- `ModelsSection.svelte` — providers/models, API keys, roles (`chat`/`edit`/`apply`/`autocomplete`).
- `AgentsSection.svelte` — specialized agents (system prompt + allowed tools).
- `WorkflowsSection.svelte` — predefined/custom workflows.
- `PromptsSection.svelte` — `/name` prompt library.
- `McpSection.svelte` / `ToolsSection.svelte` — MCP servers (builtins + external) and per-tool policies.
- `WebSearchSection.svelte` — default sources for web search (DuckDuckGo, free, no key).
- `DocsSection.svelte` — indexed documentation sites (`@docs:`).
- `WorkspacesSection.svelte` — workspace profiles (CLAUDE.md-style instructions, UI alternative to `JARVIS.md`).

### `src/frontend/shared/`

- `types.ts` — **hand-maintained mirror** of the backend config types (`packages/core/src/config/config-manager.ts`): `JarvisConfig`, `ModelItem`, `RuleItem`, `SpecializedAgent`, `TodoItem`, `WebSearchConfig`, etc. Keep it manually in sync every time a config field is added on the backend side.
- `commands.ts` — registry of `/` commands and `@` mentions offered by chat autocompletion (`SLASH_COMMANDS`, `AT_MENTIONS`, `matchTrigger`, `filterCommands`).
- `constants.ts` — `APP_NAME` and global constants.
- `utils.ts` — shared utilities.

### `src/frontend/lib/vscode-api.ts`

Wrapper around `acquireVsCodeApi()` (called once, reused everywhere) — `postMessage`, `getState`/`setState` for webview state persistence.

## Getting started

1. Install dependencies: `npm install`
2. Build webview: `npm run build:webview` (or `npm run watch:webview` for dev hot-reload)
3. `F5` in VS Code to open the Extension Development Host and see the real webview.
4. Frontend tests: `npx vitest run test/frontend/` — mount `App.svelte` via `@testing-library/svelte` (`happy-dom`) and simulate backend→webview messages with `window.dispatchEvent(new MessageEvent('message', { data }))` (see `test/frontend/approval-diff-review.test.ts`, `test/frontend/todo-list.test.ts`).

## Technical notes

- Svelte **5** in runes mode (`$state`, `$derived`, `$effect`, `$props()`) — no Svelte 4 legacy syntax.
- Build driven by Vite → `dist/webview/assets/app.js` + `app.css`, loaded by the extension host via `localResourceRoots` with a strict CSP nonce.
- Styles driven by VS Code's native CSS variables (`--vscode-*`) for light/dark theme compatibility.
- No external state management dependency: everything goes through Svelte 5 runes in `App.svelte`, passed down as props to children.
