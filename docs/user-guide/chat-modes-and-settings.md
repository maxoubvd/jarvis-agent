# Chat Modes & Settings

← [Back to the User Guide](README.md)

This page covers how Jarvis decides what to do (**modes**), how much it asks before acting (**HITL**), every **setting**, and a reference for the remaining **features**.

- [Chat modes](#chat-modes)
- [Human-in-the-Loop (HITL) modes](#human-in-the-loop-hitl-modes)
- [Auto-open modes](#auto-open-modes)
- [VS Code settings](#vs-code-settings)
- [The Settings tab & config files](#the-settings-tab--config-files)
- [Model roles](#model-roles)
- [Feature reference](#feature-reference)

---

## Chat modes

The chat input has three modes. Cycle them with **`Shift+Tab`** (or the mode selector).

| Mode | Description | Best for |
|---|---|---|
| **Automatic** *(default)* | An intention classifier reads your message first and routes it to a plain answer, a tool-using agentic run, or Plan mode. Its reasoning streams to the UI as "thinking". | Everyday coding — let Jarvis decide. |
| **Fast** | Direct streaming answer with **no tools** — immediate text only. | Quick questions, explanations, no file changes. |
| **Plan** | Jarvis explores the project **read-only** and writes a full implementation plan for you to review, then shows a **Proceed** button to execute it. | Validating an approach before any file is touched. |

> **Small models auto-switch.** If your active model is small (Ollama / LM Studio, or a name containing `7b`/`8b`), Jarvis forces **Fast** mode and hides **Plan** — you'll see `*(Small model detected: Automatic switch to Fast mode)*`. Small models handle single-shot tasks better than long agentic loops.

---

## Human-in-the-Loop (HITL) modes

HITL controls how often Jarvis asks permission before acting (running terminal commands, writing files). Set it in **Settings** (instant switch) or via `jarvis.hitl.mode`.

| Mode | Behavior |
|---|---|
| **strict** | Confirms **every** terminal command and file edit before it runs. Maximum supervision. |
| **moderate** *(default)* | Confirms risky/dangerous actions but trusts routine ones. Balanced. |
| **free** | Fully autonomous — no approval prompts. Use only in trusted, disposable environments. |

> Some operations are always gated regardless of mode (e.g. `@write`/`@run`, custom tools), and the TODO checklist tool is always auto-approved so it never interrupts you.

---

## Auto-open modes

Controls whether Jarvis automatically opens the file it just edited (in a preview tab). Set via `jarvis.autoOpen.mode`.

| Mode | Behavior |
|---|---|
| **always** *(default)* | Always open the edited file. |
| **never** | Never auto-open. |
| **strict-hitl-only** | Only open when you're in **strict** HITL (where you're already reviewing each action). |

---

## VS Code settings

Search "Jarvis" in VS Code **Settings**, or edit `settings.json`. All keys live under `jarvis.*`:

| Setting | Type | Default | Description |
|---|---|---|---|
| `jarvis.hitl.mode` | `strict` \| `moderate` \| `free` | `moderate` | Human-in-the-Loop validation mode |
| `jarvis.autoOpen.mode` | `always` \| `never` \| `strict-hitl-only` | `always` | Auto-open the file edited by the agent |
| `jarvis.autocomplete.enabled` | boolean | `false` | Inline autocomplete (Tab / ghost text) — calls a model on every typing pause |
| `jarvis.agent.maxIterations` | number | `100` | Max agent-loop iterations before asking permission to continue |
| `jarvis.tdd.maxAttempts` | number | `5` | Max attempts for the Auto-TDD loop |
| `jarvis.tdd.testCommand` | string | `npm test` | Test command used by Auto-TDD |
| `jarvis.terminal.timeout` | number (ms) | `30000` | Terminal command timeout |
| `jarvis.models.default` | string | `""` | *Legacy* — the default model is managed in the Settings tab instead |

---

## The Settings tab & config files

Most configuration is done visually in the **Settings tab** of the Jarvis sidebar. It's stored in:

- `~/.jarvis/config.json` — global (all workspaces).
- `<workspace>/jarvis/jarvis-config.json` — optional per-workspace override, **deep-merged** over the global one.

The Settings tab has these sections:

| Section | What you configure |
|---|---|
| **Models** | Add/remove models per provider, API keys, context length, and [roles](#model-roles). Set the default model. |
| **Agents** | Edit each [specialized agent](agents-and-workflows.md#specialized-agents)'s system prompt and allowed tools; add your own. |
| **Web Search** | Default source sites for `search_web` (StackOverflow, MDN, GitHub, devdocs.io, or your own domains). Provider is DuckDuckGo (free, no key). |
| **Workflows** | Customize or add [workflows](agents-and-workflows.md#workflows). |
| **Prompts** | Save reusable prompts as `/name` [shortcuts](chat-commands.md#your-saved-prompt). |
| **Docs** | Configure documentation sources indexed for `@docs:` search. |
| **Workspaces** | Manage per-workspace settings. |

Other UI toggles: **verbosity** (Concise / Detailed), **show/hide the agent's thoughts**, and the **autocomplete** on/off switch.

---

## Model roles

In **Settings → Models** you can tag each model with a **role**, so different jobs use the right model:

| Role | Used for |
|---|---|
| `chat` | The main conversation / agent |
| `edit` | Applying edits |
| `apply` | Applying changes |
| `autocomplete` | Inline ghost-text completion |

If no model is tagged for `chat` or `autocomplete`, both fall back to your default model. A common setup: a fast/cheap local model for `autocomplete`, a stronger model for `chat`.

---

## Feature reference

Everything else Jarvis provides, with a short description and where it lives.

### RAG & semantic search (`@docs`)

A local, in-memory embedding index over your workspace files (no external vector database — embeddings run on-device via `@xenova/transformers`). It powers **`@docs:<query>`** semantic search. Built automatically in the background when the sidebar opens; rebuild it with **`Jarvis: Index Workspace (RAG)`**. Only sandbox-allowed files are indexed.

### AST pruning

For large files, Jarvis analyzes the syntax tree (via `tree-sitter`) and reads only the **relevant functions/classes** instead of the whole file — big token savings without losing context. Supports JS, TS, Python, Java, Go, Rust, C++, C#, PHP, and Ruby. Automatic; no configuration needed.

### Token gauge

A live counter (in the panel and the status bar) showing input/output tokens for the session, with the last few requests and green/orange/red thresholds so you can see when a conversation is getting expensive. Jarvis tracks **tokens**, not monetary cost.

### Checkpoints & rollback

Jarvis saves git-based **checkpoints** before risky operations (before each agentic run, before workflows and Auto-TDD, and at session start). Restore any of them from the **Checkpoints** tab, with `/rollback` (undo since your last message), or the `Jarvis: Rollback to Checkpoint` / `Jarvis: List Checkpoints` commands. Restores use a stable checkpoint id and show a diff preview with conflict handling. This is your safety net — experiment freely.

### Secret scrubbing

Before any prompt is sent to a **cloud** provider, a scrubber removes secrets — API keys, JWTs, private keys, passwords, AWS keys (`AKIA…`), GitHub tokens (`ghp_…`). Local providers aren't scrubbed by default. See also `SECURITY.md` in the repo.

### Sandbox & `.jarvisignore`

The agent is confined to your workspace (path-traversal and symlink protection). A **`.jarvisignore`** file — auto-generated on first activation and **stricter than `.gitignore`** — lists what the agent may never read or send, by default including `.env*`, `node_modules/`, build artifacts, `*.pem`/`*.key`/`*.crt`, `secrets/`, `credentials/`, databases, and the `.jarvis/` folder. Manage it with `Jarvis: Generate/Add to/Remove from .jarvisignore` (Add is also on the Explorer right-click menu). Each folder in a multi-root workspace has its own file.

### MCP servers

Via the **Model Context Protocol**, Jarvis can use external tools — GitHub, a PostgreSQL database, a third-party MCP server — configured in **Settings → MCP**. Built-in servers (git, filesystem, fetch, memory) are included. MCP tools are never stripped by an agent's tool restrictions.

### Custom tools

Drop JSON files in `<workspace>/jarvis-tools/*.json` to define your own tools (`{name, description, parameters, command}` with `{param}` placeholders). They're shell-sanitized and always HITL-gated, and appear to the agent alongside the built-in tools.

### Web search (`search_web`)

Free web search powered by **DuckDuckGo** — no API key or account. Configure default source sites in **Settings → Web Search**; the model can also target specific sites per query.

### Analytics

Usage stats (tokens per model/session, actions, success rate, average time) persisted in `.vscode/jarvis-stats.json` and shown in the **Analytics** tab as simple bar charts. Export them with `Jarvis: Export Analytics`.

### JARVIS.md & rules

- **`JARVIS.md`** — a project-instructions file (like `CLAUDE.md`) at the workspace root, generated by [`/init`](chat-commands.md#init), injected into every request, and **committed with your code** so the whole team shares the same context.
- **Rules** — personal instructions defined in Settings, injected into every request. A rule can have a **`scope` glob** (e.g. `src/backend/**`) so it only applies when the active file matches — shorter prompts, more focused answers.

---

## Related pages

- **[Tips & Best Practices](tips.md)** — how to combine all of this effectively.
- **[Getting Started](getting-started.md)** — provider setup and your first message.
