# Changelog

All notable changes to Jarvis Agent are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **Jarvis CLI (`jarvis-agent-cli`).** The extension's engine is now also a standalone terminal tool. `jarvis` opens a home page + interactive REPL with full parity: agentic chat (automatic/fast/plan), `/agent`, `/tdd`, `/workflow`, `/init`, tools with **terminal** HITL approvals (inquirer), checkpoints, RAG, `@file:`/`@docs:`/`@Agent` mentions, and a `jarvis settings` navigator — all over the same `~/.jarvis/config.json` the extension uses. The terminal UI reuses the extension's red (`#c1272d`) + gold (`#e8b84b`) design language via true-color ANSI. See `docs/cli-guide.md`.

### Changed
- **Monorepo with a shared `@jarvis/core` package.** `src/backend` moved to `packages/core` and was made **host-agnostic (no `vscode` import in its public API)** behind a small host seam: `getWorkspaceRoot()` (`JARVIS_WORKSPACE`/`process.cwd()`), a vscode-free `EventEmitter`, an injectable "currently open file" provider (`setActiveFileProvider`), an injectable HITL fallback (`setFallbackHandler`), and an `onExported` callback for analytics. The extension (`src/extension.ts` + the Svelte webview) and the new `packages/cli` are two front-ends over this one core; the extension bundles it from source via an esbuild alias, so packaging is unchanged.

## [1.1.0] - 2026-07-17

### Added
- **Rewind & fork from any message.** A per-message menu (`MessageActions.svelte`) on user turns exposes three actions: *Rewind* (restore the working tree to the checkpoint captured just before that turn), *Fork* (branch the conversation from that point, dropping the message back into the input to edit and resend), and *Fork + Rewind* (both at once). Backed by message→checkpoint tracking in `JarvisSidebarProvider` and `SessionStore.forkCurrent()` (a single-write fork that preserves the pre-fork conversation as its own session and seeds the new one with full-fidelity history, not a summary).
- **Chat mode cycling.** `Shift+Tab` cycles the input between `Automatic`, `Fast`, and `Plan` modes (Plan is hidden for small models).
- **Input history recall.** Up/Down arrows step through previously sent user messages (shell / CLI style), preserving the in-progress draft and restoring it when you step back past the newest entry.
- **Collapsible long messages.** User messages over 600 characters or 8 lines (large pastes, logs) collapse by default and expand on demand, so they don't dominate the transcript.
- **Marketplace metadata** in `package.json`: `pricing: Free`, `qna` link, GitHub-flavored `markdown`, and an explicit `untrustedWorkspaces` capability declaring that agent tools (terminal, file read/write) require a trusted workspace.

### Changed
- **Checkpoint restore is now keyed on a stable `id` instead of a positional stash ref.** `CheckpointManager` gains `restoreToCheckpoint(id)` and `listAndRestore(id)`, both re-resolving the ref via a fresh `listCheckpoints()` before applying — a captured `stash@{N}` ref goes stale the moment a newer checkpoint is created. The `/rollback` shortcut and the `listCheckpoints` command picker both restore by id, and `hardResetAndApply()` resets the tree to HEAD before re-applying so the stash lands cleanly instead of merging over newer edits.
- **Responsive frontend layout.** `AnalyticsPanel`, `TokenGauge`, `SettingsPanel`, `ChatPanel`, `CheckpointPanel`, and `McpSection` reflow for narrow sidebar widths; shared spacing tokens added to `styles/tokens.css`.
- **Type-safety cleanup** across `orchestrator.ts` and the model providers (`ollama`, `openai-compatible`): the remaining `any` casts on model messages and streamed SSE chunks are replaced with explicit `StreamChunk` / `LooseModelAction` / typed message shapes.

### Fixed
- Rewind/fork now correctly stays hidden on turns that aren't part of the tracked conversation (`/tdd`, `/workflow`, `/agent`, `/init`, and messages rehydrated on reload), via a single `recordUserTurn()` choke point that gates the `forkable` flag.
- `Fork + Rewind` rewinds before forking (and only forks if the rewind succeeded), so the chat can't advance as though the code were restored when it wasn't.

### Tests
- Added `test/backend/checkpoint.test.ts` and `test/backend/sessions.test.ts` covering id-based restore, stale-ref resolution, and single-write forking.

## [1.0.0] - 2026-07-13

First public release (Open VSX / VS Code Marketplace as "Jarvis Code Agent"). See `docs/spec.md` (§9, roadmap) and `docs/audit-2026-07-11.md` (full code audit) for the detailed history of the workstreams.

### Added
- Initial release: multi-provider agentic chat (local or cloud), inline editing (Cmd+K), Auto-TDD, local RAG, specialized agents, and Git checkpoints.

### Known limitations
- Sub-agents / parallel delegation not supported (`WorkflowRunner` remains strictly sequential).
- No monetary cost tracking (only token counting is available).
- Checkpoints use the real Git repository (`git stash`/`git commit`), not a separate "shadow" repo — may add noise to the user's Git history.
