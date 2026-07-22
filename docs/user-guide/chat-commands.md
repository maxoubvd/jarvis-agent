# Chat Commands & Mentions

← [Back to the User Guide](README.md)

Everything you can type in the Jarvis chat input. There are three families:

1. **[Deterministic tool commands](#deterministic-tool-commands)** (`@read`, `@list`, `@write`, `@run`) — run instantly, **no model involved**.
2. **[Context mentions](#context-mentions)** (`@file:`, `@docs:`) — inject context into your request.
3. **[Slash commands](#slash-commands)** (`/init`, `/tdd`, …) — trigger modes and multi-step routines.

> **Autocomplete:** type `/` at the start of a line to see slash commands, or `@` (at the start of a line or after a space) to see mentions and tool commands. The input also shows a live hint bar with the most common ones.
>
> Agent mentions (`@QA-Agent`, etc.) are documented on the **[Agents & Workflows](agents-and-workflows.md)** page.

---

## Deterministic tool commands

These four commands run a single local operation with **no AI model**, so they're instant and free. Write the command at the **start** of your message.

### `@read <path>`

**Description.** Reads the file at `<path>` and prints its contents in a code block. The output is passed through the secret scrubber first; if any secrets are detected it appends `⚠️ N secret(s) hidden before display.`

**Example.**
```
@read src/backend/services/hitl.ts
```

### `@list [path]`

**Description.** Lists the contents of a directory. `<path>` is optional and defaults to the current folder (`.`). Entries are shown as `📁 name` (folder) or `📄 name`; an empty folder prints `(vide)`.

**Example.**
```
@list src/backend/services
```

### `@write <path> <content>`

**Description.** Writes `<content>` to `<path>`. Everything up to the first space is the path; everything after is the content (empty content is allowed). This is **gated by [HITL](chat-modes-and-settings.md#human-in-the-loop-hitl-modes)** approval — if you deny it, Jarvis prints `❌ <reason>`. On success it prints `✅ Written: <path>` and re-indexes the file for RAG.

**Example.**
```
@write notes/todo.md - [ ] Refactor the auth module
```

### `@run <cmd>`

**Description.** Runs `<cmd>` in the terminal. **HITL-gated** (denying prints `❌ <reason>`). Live output streams into the chat, then the full stdout+stderr is shown in a code block, followed by either `⏱️ Timeout` or `Code de sortie: <exitCode>`. The timeout comes from the `jarvis.terminal.timeout` setting (default 30 000 ms).

**Example.**
```
@run npm test
```

> Any unknown `@word` at the start of a message returns: `Commande inconnue: @<command>. Disponibles: @read, @list, @write, @run`.

---

## Context mentions

These don't run on their own — they **enrich your request** with extra context, then the message is processed normally. You can combine them with any prompt or slash command. Use quotes for paths/queries that contain spaces.

### `@file:<path>`

**Description.** Reads a file and injects its full content into the request under a `--- CONTEXT ---` section, so the model can reason about exact code without you pasting it. If the file can't be read, a small `(Unable to read …)` note is injected instead. The frontend also suggests live workspace files as you type `@`.

**Examples.**
```
@file:src/extension.ts  Where is the sidebar registered?
```
```
@file:"my folder/notes.md"  Summarize this.
```

### `@docs:<query>`

**Description.** Runs a **semantic (RAG) search** over your indexed documentation and code (Markdown files and any configured doc sites), and injects the top matching snippets. `-` and `_` in the query become spaces. Great for finding relevant material **by concept**, not just by keyword.

**Examples.**
```
@docs:authentication  How do we handle login?
```
```
@docs:"rate limiting"  Is there anything about throttling?
```

> The index is built in the background when the sidebar opens. You can rebuild it any time with the **`Jarvis: Index Workspace (RAG)`** command. See [RAG & indexing](chat-modes-and-settings.md#rag--semantic-search-docs).

---

## Slash commands

Type these at the **start** of the chat input. Six command names are **reserved** and can never be overridden by your saved prompts: `tdd`, `workflow`, `agent`, `new`, `resume`, `init`.

### `/init`

**Description.** Analyzes your project and generates a **`JARVIS.md`** file at the workspace root (Project Overview, Build & Test Commands, Architecture, Conventions, Notes for Agents). If git isn't initialized it offers to run `git init` first (with a confirmation). If `JARVIS.md` already exists, it warns before replacing it. `JARVIS.md` is then injected into every request. Also available as the Command Palette command **`Jarvis: Initialize Project`**.

**Example.**
```
/init
```

### `/tdd <task>`

**Description.** Runs the **Auto-TDD loop**: Jarvis writes the test(s) and implementation, runs your test command, reads any failure, and retries — up to a max number of attempts. A checkpoint is created first so you can roll back. Defaults: max attempts `5` (`jarvis.tdd.maxAttempts`), test command `npm test` (`jarvis.tdd.testCommand`), timeout that doubles on each retry. See [Auto-TDD](agents-and-workflows.md#auto-tdd-tdd).

**Example.**
```
/tdd write a function that returns the nth Fibonacci number
```

### `/workflow <id> <task>`

**Description.** Runs a **predefined multi-step workflow** sequentially, passing each step's summary to the next. The task checklist above the input is pre-filled with the step names. See [Workflows](agents-and-workflows.md#workflows) for the full list of ids and their steps.

Available ids: `dynamic`, `dev-feature`, `bug-fix`, `code-review`, `refactor`, `setup-project`.

**Example.**
```
/workflow bug-fix users can submit the signup form twice
```

### `/agent <task>`

**Description.** Starts a full **agentic run** on `<task>` with the complete tool registry (no persona restriction). Jarvis augments the task with relevant code context (RAG), then plans and executes with tools, creating a checkpoint first. Ends with a `✅ Completed in N iteration(s)` badge.

**Example.**
```
/agent add a dark-mode toggle to the settings panel and wire it to the theme store
```

### `/new`

**Description.** Starts a **fresh conversation**: clears the message history and checkpoints, resets the token counter, and empties the task checklist.

**Example.**
```
/new
```

### `/resume [id|index]`

**Description.** Reopens a **past conversation**. With no argument it shows a picker of previous sessions (title, message count, date). With a session id or 1-based index it resumes that one directly, using a summarized context and a `Resumed: <title>` session title.

**Examples.**
```
/resume
```
```
/resume 2
```

### `/rollback`

**Description.** Undoes **all file changes made since your last message**, restoring the checkpoint captured before that turn. Prints a confirmation (or a failure message if it can't). For undoing further back, use the **Checkpoints** tab or the `Jarvis: Rollback to Checkpoint` command. See [Checkpoints](chat-modes-and-settings.md#checkpoints--rollback).

**Example.**
```
/rollback
```

### `/<your-saved-prompt>`

**Description.** Any prompt you save in **Settings → Prompts** becomes a `/name` shortcut. Typing `/name some args` expands to your saved prompt content, followed by your args, and then runs normally. Names are case-insensitive and cannot shadow the six reserved commands. Jarvis ships two disabled examples — a `Commentator` rule and an `/explain` prompt — that you can enable or duplicate.

**Example** (after enabling the shipped `/explain` prompt):
```
/explain the regex on line 42 of parser.ts
```

---

## Related pages

- **[Agents & Workflows](agents-and-workflows.md)** — `@…-Agent` mentions, the workflow catalog, Auto-TDD.
- **[Chat Modes & Settings](chat-modes-and-settings.md)** — modes, HITL, and every feature the commands touch.
