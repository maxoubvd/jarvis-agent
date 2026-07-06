# Jarvis Agent — User Guide

Jarvis Agent is a VS Code extension that embeds an agentic coding assistant in your sidebar. It can chat, read/write files, run terminal commands, run an auto-fix TDD loop, execute multi-step workflows, and delegate to specialized agents — all gated by a human-in-the-loop (HITL) approval system and a workspace sandbox.

This guide covers day-to-day usage. For internals, see `CLAUDE.md`; for the full functional spec, see `spec.md`.

## 1. Setup

```bash
npm install
npm run build      # compiles backend (tsc) + frontend (vite)
```

Press **F5** in VS Code to launch an Extension Development Host with the build. The Jarvis icon appears in the Activity Bar; click it to open the sidebar (or run **Jarvis: Start Chat** from the Command Palette).

For active frontend development, run `npm run watch:webview` in a terminal and reload the Extension Development Host after changes.

### Configure a model provider

Model config lives in `jarvis/jarvis-config.json` at your **workspace root** (not the extension's own repo, unless you're testing on itself). Example:

```json
{
  "models": {
    "default": "qwen2.5-coder:7b",
    "providers": {
      "ollama": {
        "enabled": true,
        "baseUrl": "http://localhost:11434",
        "models": [{ "name": "qwen2.5-coder:7b", "contextLength": 32768 }]
      },
      "openrouter": {
        "enabled": false,
        "apiKey": "",
        "baseUrl": "https://openrouter.ai/api/v1",
        "models": [{ "name": "deepseek-coder-v3", "contextLength": 262144 }]
      }
    }
  }
}
```

- `default` must name a model that exists under an **enabled** provider, or chat will report "Aucun provider disponible."
- For local models, install [Ollama](https://ollama.ai/) and pull the models you list (`ollama pull qwen2.5-coder:7b`).
- For cloud providers (OpenRouter, Mistral), set `enabled: true` and fill in `apiKey`. Secrets in your prompts are automatically scrubbed before being sent to any cloud provider — this is not optional and can't be disabled per-provider, only bypassed per-prompt via the UI.
- Switch models anytime from the model dropdown in the sidebar; it persists back to this file.

## 2. Chat basics

Type in the sidebar chat box. Responses stream token-by-token with a live token gauge (status bar + sidebar) showing input/output split and a green/orange/red threshold against the model's context limit.

**Direct tool commands** (no model call, deterministic):
| Command | Effect |
|---|---|
| `@read <path>` | Print file contents (secrets scrubbed) |
| `@list <path>` | List a directory |
| `@write <path> <content>` | Write a file (HITL-gated) |
| `@run <command>` | Run a shell command (HITL-gated, streamed output) |

**Context mentions** (expanded before sending to the model):
| Mention | Effect |
|---|---|
| `@file:src/foo.ts` | Inlines the file's content into your prompt |
| `@docs:some query` | Runs a semantic search over the indexed workspace and inlines the best matches |

## 3. Agent mode

Free-form requests ("refactor this function", "add a login page") are handled two ways:

- **`/agent <task>`** — explicit agentic loop: the model reasons in a `{"thought", "action": {tool, args}}` / `{"thought", "final"}` JSON protocol, calling tools (read/write/edit files, list dirs, run terminal, view diff, git status/log, search web, plus any custom tools) until it reaches a final answer or hits `jarvis.agent.maxIterations` (default 10).
- **Plain chat** — if your message matches a specialized agent's keywords, Jarvis suggests mentioning that agent inline rather than auto-invoking it.

Every tool call the agent wants to make is shown in the chat (thinking, tool name + args, result summary) and is gated by HITL according to the tool's risk (see §6).

A git-stash checkpoint (`action` type) is created automatically right before an agent run starts, so you can always roll back (§7).

### Specialized agents

Mention one directly to give the model a domain-specific system prompt and focus:

| Mention | Focus |
|---|---|
| `@QA-Agent` | Code review, bugs, tests, coverage |
| `@Doc-Agent` | Documentation, README, JSDoc |
| `@Refactor-Agent` | Safe, incremental refactoring with test verification |
| `@Security-Agent` | Vulnerabilities, hardcoded secrets, input validation |
| `@Perf-Agent` | Bottlenecks, algorithmic complexity, profiling |

Example: `@Security-Agent audit the auth middleware for token handling issues`

## 4. Auto-TDD loop

```
/tdd Add input validation to the signup form
```

Runs: generate code → write file(s) → run tests (`jarvis.tdd.testCommand`, default `npm test`) → on failure, analyze output and retry, up to `jarvis.tdd.maxAttempts` (default 5). Each attempt and its test output streams into the chat. A `workflow`-type checkpoint is created before the loop starts.

Configure via VS Code settings: `jarvis.tdd.maxAttempts`, `jarvis.tdd.testCommand`, `jarvis.terminal.timeout`.

## 5. Workflows

```
/workflow <id> <task>
```

Five predefined multi-step sequences, each step feeding the previous step's summary into the next, run through the same agentic tool loop:

| id | Steps |
|---|---|
| `dev-feature` | Planifier → Coder → Tester → Commiter |
| `bug-fix` | Analyser → Reproduire → Corriger → Tester |
| `code-review` | Lire Code → Exécuter Tests → Analyser → Suggérer |
| `refactor` | Analyser → Planifier → Appliquer → Tester |
| `setup-project` | Initialiser → Configurer → Dépendances → Structure |

Example: `/workflow bug-fix Login button does nothing on Safari`

If a step fails, the workflow stops and reports which step and why.

## 6. Security & HITL

Three approval modes, set via the sidebar dropdown or `jarvis.hitl.mode` setting:

| Mode | Behavior |
|---|---|
| `strict` | Every file write / terminal command needs explicit approval, every time |
| `moderate` (default) | Low-risk actions auto-approved; writes/commands still confirmed, with session-level "always allow this" |
| `free` | Minimal friction — use only in trusted, disposable workspaces |

**Sandbox**: all file operations are confined to the open workspace folder; paths are normalized and checked, and outbound symlinks are blocked.

**`.jarvisignore`**: stricter than `.gitignore` — a file listed here is invisible to the AI even if Git tracks it. Manage it via Command Palette:
- `Jarvis: Generate .jarvisignore` — write the recommended default patterns (secrets, node_modules, build output, keys, etc.)
- `Jarvis: Add to .jarvisignore` — right-click a file in Explorer, or use the command and type a pattern
- `Jarvis: Remove from .jarvisignore` — pick a pattern to remove

Run **Generate** once per workspace before doing serious work with Jarvis.

**Secret scrubbing**: applied automatically to anything sent to a cloud provider (API keys, JWTs, private keys, passwords, AWS/GitHub tokens). Local Ollama/LM Studio traffic is not scrubbed by default since it never leaves your machine.

## 7. Checkpoints ("Time Travel")

Jarvis stashes a git checkpoint automatically:
- At session start
- Before any agent run, TDD loop, or workflow

View and restore via the sidebar's **Checkpoints** tab, or:
- `Jarvis: List Checkpoints` — pick one from the Command Palette to roll back
- `Jarvis: Rollback to Checkpoint` (same picker, from the sidebar button)

Rollback restores the exact stashed state. If you have uncommitted changes at rollback time, resolve/stash them first — Jarvis won't silently discard work.

## 8. Analytics

The **Analytics** tab in the sidebar shows session stats (tokens per model, action success rate, average duration) backed by `.vscode/jarvis-stats.json`. Export with `Jarvis: Export Analytics` or the sidebar button.

## 9. Custom tools

Drop JSON files in a `jarvis-tools/` folder at your workspace root:

```json
{
  "name": "run_migrations",
  "description": "Apply pending database migrations",
  "parameters": { "env": "Target environment (dev/staging)" },
  "command": "npm run migrate -- --env={env}"
}
```

- Loaded automatically alongside the built-in tools whenever the agent runs.
- `{param}` placeholders are substituted from the model's tool-call args; shell metacharacters in values are sanitized.
- Always routed through the `terminal` HITL gate, regardless of mode.

## 10. Settings reference

| Setting | Default | Purpose |
|---|---|---|
| `jarvis.models.default` | `deepseek-coder-v3` | Fallback default model name |
| `jarvis.hitl.mode` | `moderate` | `strict` \| `moderate` \| `free` |
| `jarvis.agent.maxIterations` | `10` | Max tool-call rounds per agent run |
| `jarvis.tdd.maxAttempts` | `5` | Max Auto-TDD retry attempts |
| `jarvis.tdd.testCommand` | `npm test` | Command run to validate each TDD attempt |
| `jarvis.terminal.timeout` | `30000` | Terminal command timeout (ms) |

## 11. Troubleshooting

- **"Aucun provider disponible"** — `jarvis/jarvis-config.json`'s `default` model isn't under any `enabled: true` provider. Fix the default or enable the right provider.
- **Ollama requests fail** — confirm `ollama serve` is running and the model is pulled (`ollama list`).
- **File/command blocked unexpectedly** — check `.jarvisignore` and current HITL mode; blocked actions are logged to the **Jarvis Agent** output channel.
- **`@docs:` returns nothing** — run `Jarvis: Index Workspace (RAG)` once; indexing also happens automatically in the background when the sidebar opens.
- **Stale build** — after pulling changes or editing backend/frontend code, re-run `npm run build` (or keep `npm run watch:webview` running for frontend-only iteration) and reload the Extension Development Host.
