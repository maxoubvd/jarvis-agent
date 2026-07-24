# Jarvis CLI — User Guide

Jarvis in your terminal. The CLI (`jarvis-agent-cli`, command `jarvis`) is a front-end over the
**same engine** as the VS Code extension (`@jarvis/core`): the agentic orchestrator, model
providers, tools, sandbox, checkpoints, RAG, specialized agents, workflows and Auto-TDD are shared.
It reads and writes the **same** `~/.jarvis/config.json`, so anything you configure in the extension
is available in the CLI and vice-versa.

> The extension's demo video (`media/user_guide_jarvis.mp4`) covers the sidebar UI only. This written
> guide is the reference for the terminal experience.

## Install

```bash
npm install -g jarvis-agent-cli
```

Then, from inside any project:

```bash
jarvis
```

No global install needed for a quick try: `npx jarvis-agent-cli`. To verify: `jarvis --version`.

> The CLI relies on the local RAG stack (`@xenova/transformers`, `web-tree-sitter`), which stays
> external to the bundle — so the install pulls a sizeable dependency. That is the price of
> on-device embeddings with no cloud.

### Working on the CLI itself

If you're developing it rather than just using it, work from the repository instead:

```bash
git clone https://github.com/maxoubvd/extension-VS-code.git
cd extension-VS-code
npm install
npm run build:cli
npm link --workspace jarvis-agent-cli   # `jarvis` now points at your local build
```

Re-run `npm run build:cli` after each change — the link picks up the new build automatically.
`npm unlink -g jarvis-agent-cli` restores the published version.

## First run

If you have never configured Jarvis, run:

```bash
jarvis settings
```

Add a model under **Models** (Ollama/LM Studio for local & free, or OpenRouter/Mistral/OpenAI-compatible
for cloud), set it as default, and you're ready. The workspace is simply the directory you run `jarvis`
from.

## The home page

Running `jarvis` with no arguments prints the home page — the red **JARVIS** wordmark, your active
model & provider, the workspace path, and your approval (HITL) mode — then drops you into the
interactive REPL.

## Commands (subcommands)

| Command | What it does |
|---|---|
| `jarvis` | Home page + interactive REPL |
| `jarvis "<prompt>"` | One-shot: run the agent once, print the answer, exit |
| `jarvis -p "<prompt>"` | Same, explicit flag |
| `jarvis settings` | Interactive settings navigator (models, approvals, chat, web search, profile) |
| `jarvis config` | Open `~/.jarvis/config.json` in `$EDITOR` (for agents/workflows/rules/MCP) |
| `jarvis checkpoints` | List Git "time-travel" checkpoints |
| `jarvis rollback` | Roll back to the last checkpoint |
| `jarvis init` | Analyze the project and generate `JARVIS.md` |
| `jarvis analytics` | Export usage analytics to `.vscode/` |
| `jarvis --help` / `--version` | Usage / version |

## The REPL

Type a request and press Enter. In **automatic**/**plan** mode Jarvis runs the full agentic loop
(reading files, editing, running commands — with approvals); in **fast** mode it answers as plain chat.

Slash commands (mirroring the extension):

- `/agent <task>` — force the agentic loop
- `/tdd <task>` — Auto-TDD: write code → run tests → fix, until green
- `/workflow <id> <task>` — run a predefined multi-step workflow (`dev-feature`, `bug-fix`, `code-review`, `refactor`, `setup-project`, `dynamic`)
- `/init` — analyze the project and write `JARVIS.md`
- `/mode automatic|fast|plan` — switch chat mode
- `/model [name]` — show, or set, the default model
- `/settings` — open the settings navigator
- `/checkpoints` — list checkpoints and roll back
- `/rollback` — roll back to the last checkpoint
- `/new` (or `/clear`) — start a fresh conversation
- `/help` — list everything
- `/exit` (or Ctrl-C) — quit

Mentions work inline in any message:

- `@file:src/app.ts` — inject a file's content as context (quote paths with spaces: `@file:"my dir/x.ts"`)
- `@docs:how does auth work` — semantic search over your indexed documentation
- `@QA-Agent`, `@Doc-Agent`, `@Refactor-Agent`, `@Security-Agent`, `@Perf-Agent` — delegate to a specialized agent whose tool access is restricted to its role

## Approvals (Human-in-the-Loop)

Before a sensitive action (running a terminal command, editing sensitive files…), Jarvis asks in the
terminal: **Allow once / Allow for this session / Deny**. Denying lets you type guidance the agent will
follow instead. Your mode (`strict` / `moderate` / `free`, set in `jarvis settings` → Approvals)
controls how often you're asked — identical semantics to the extension.

## Safety

The same guarantees as the extension apply: the **sandbox** confines file access to the workspace and
honors `.jarvisignore` (stricter than `.gitignore`); **secret scrubbing** redacts credentials from
prompts sent to cloud providers; and Jarvis stashes a **git checkpoint** before workflows so
`jarvis rollback` can undo its impact.

## Configuration

Everything lives in `~/.jarvis/config.json` (plus an optional per-project `jarvis/jarvis-config.json`
override). Because the CLI and the extension share this file, you can manage models, rules, agents,
workflows, prompts, MCP servers and optimization settings from either side. The high-frequency knobs
are editable directly in `jarvis settings`; the richer list editors open the JSON in your `$EDITOR`.
