# Tips & Best Practices

← [Back to the User Guide](README.md)

How to get the maximum out of Jarvis while keeping your **token usage** and **risk** under control.

---

## Set up the project once

### Write a `JARVIS.md`
Run [`/init`](chat-commands.md#init) once per project. It generates a `JARVIS.md` that's injected into **every** request, so Jarvis always knows your build commands, architecture and conventions — no re-explaining. Because it's committed with your code (unlike personal rules), the whole team gets the same context automatically.

### Scope rules to folders
Instead of one long global rule, give a rule a **`scope` glob** (e.g. `src/backend/**`) in Settings. Scoped rules only load when the active file matches, so prompts stay short and answers stay focused. Unscoped rules always apply.

### Tag model roles deliberately
In **Settings → Models**, assign a fast/cheap model to the `autocomplete` role and a stronger one to `chat`, rather than one model for everything. You get snappy completions and high-quality answers at the same time.

### Save your recurring prompts as `/shortcuts`
**Settings → Prompts** turns any instruction you repeat into a `/name` command. Jarvis ships two disabled examples — a `Commentator` rule and an `/explain` prompt — enable them or duplicate them as a starting point.

---

## Spend fewer tokens

### Reach for `@file` and `@docs` before pasting code
[`@file:path`](chat-commands.md#filepath) pulls in exactly the file you mean, and [`@docs:query`](chat-commands.md#docsquery) searches your indexed docs/code **semantically**. Both are cheaper and more accurate than dropping large code blocks into the chat — and AST pruning + RAG mean Jarvis reads only the relevant parts of big files.

### Match the chat mode to the task
Cycle modes with `Shift+Tab`:
- **Fast** — quick text-only questions (no tool calls, minimal tokens).
- **Automatic** — everyday coding; let Jarvis route.
- **Plan** — validate the approach before Jarvis touches any files.

### Watch the token gauge
The gauge turns orange then red as a conversation grows. When it's getting expensive, start fresh with [`/new`](chat-commands.md#new) or [`/resume`](chat-commands.md#resume-idindex) a summarized older thread instead of carrying a huge history.

---

## Let Jarvis structure multi-step work

### Delegate to a specialized agent
Each [agent](agents-and-workflows.md#specialized-agents) has tool access restricted to its role, which keeps it focused and safer to run unattended:
- **`@Security-Agent`** — read-only vulnerability audit.
- **`@QA-Agent`** — run tests and review, without editing.
- **`@Refactor-Agent`** — refactor with edits re-verified against the test suite.
- **`@Doc-Agent`** / **`@Perf-Agent`** — docs / performance analysis.

### Use `/tdd` and `/workflow` for sequences
[`/tdd <task>`](agents-and-workflows.md#auto-tdd-tdd) drives a write → test → fix loop automatically. [`/workflow <id> <task>`](agents-and-workflows.md#workflows) runs a predefined sequence (or `dynamic` for an auto-decomposed task) instead of you prompting step by step.

---

## Stay safe

### Tune HITL to your risk tolerance
Pick per project in Settings:
- **strict** — confirm every command and edit.
- **moderate** — trust routine actions (default).
- **free** — fully autonomous; only in trusted, disposable environments.

### Use checkpoints as a safety net
Jarvis stashes a git [checkpoint](chat-modes-and-settings.md#checkpoints--rollback) before actions, workflows and TDD, so you can experiment freely and undo anything: [`/rollback`](chat-commands.md#rollback), the **Checkpoints** tab, or per-message [Rewind](shortcuts.md#per-message-actions).

### Keep secrets out of the sandbox
Maintain [`.jarvisignore`](chat-modes-and-settings.md#sandbox--jarvisignore) (auto-generated, stricter than `.gitignore`) so credentials and sensitive folders are never read or sent to a cloud model. Right-click any file in the Explorer → **Add to .jarvisignore**. Secret scrubbing is a second line of defense for cloud providers, but excluding files is the strongest.

### Review before approving in moderate mode
In `moderate` and `strict` modes, read the HITL prompt before you approve a command or edit — especially for anything that deletes files or hits the network. Treat external MCP servers and web/doc sources as untrusted input.

### Use the Stop button
If a task is stuck or running longer than expected, hit the **Stop (■)** button in the chat panel to interrupt the agent and cancel the request.

---

## Related pages

- **[Chat Modes & Settings](chat-modes-and-settings.md)** — the details behind each toggle.
- **[Agents & Workflows](agents-and-workflows.md)** — the structured-work tools.
