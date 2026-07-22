<div align="center">
  <img src="../../media/jarvis-icon.png" alt="Jarvis Agent Logo" width="96"/>
  <h1>Jarvis Agent — User Guide</h1>
  <p><strong>The complete reference for every feature, command, shortcut and setting.</strong></p>
</div>

---

**Jarvis Agent** is an agentic AI coding assistant embedded directly in Visual Studio Code. It chats, reads and edits your files, runs terminal commands, searches the web, writes tests, and can drive whole multi-step workflows — using the model of your choice (local **or** cloud). This guide documents everything the extension can do, with examples.

> New here? Start with **[Getting Started](getting-started.md)**. Looking for a specific command or shortcut? Jump to the [Quick Reference](#-quick-reference) below.
>
> ← Back to the [project README](../../README.md).

---

## 📚 Table of contents

| Page | What it covers |
|---|---|
| **[Getting Started](getting-started.md)** | Install, open the sidebar, connect a model (local or cloud), send your first message. |
| **[Chat Commands & Mentions](chat-commands.md)** | Everything you can type in the chat: `@read/@list/@write/@run`, `@file:`/`@docs:`, and all `/` slash commands. |
| **[Agents & Workflows](agents-and-workflows.md)** | The 5 specialized agents, the 6 workflows, Auto-TDD, and the task checklist. |
| **[Keyboard Shortcuts & Controls](shortcuts.md)** | Every key, button, CodeLens and Command Palette command. |
| **[Chat Modes & Settings](chat-modes-and-settings.md)** | Automatic/Fast/Plan modes, HITL modes, all settings, and a full feature reference. |
| **[Tips & Best Practices](tips.md)** | How to get the maximum out of Jarvis while keeping tokens and risk under control. |

---

## ⚡ Quick reference

### Keyboard shortcuts

| Shortcut | Where | Action |
|---|---|---|
| `Ctrl+K Ctrl+K` / `Cmd+K Cmd+K` | Code editor (with a selection) | **Inline Edit** — describe a change, applied in place |
| `Tab` | Code editor | Accept the inline autocomplete suggestion *(if enabled)* |
| `Shift+Tab` | Chat input | Cycle chat mode: **Automatic → Fast → Plan** |
| `↑` / `↓` | Chat input (empty) | Recall your previous / next messages |
| Stop button (■) | Chat panel | Interrupt the running agent / cancel the request |

### Slash commands (type at the start of the chat input)

| Command | Purpose |
|---|---|
| `/init` | Analyze the project and generate a versioned `JARVIS.md` |
| `/tdd <task>` | Auto-TDD loop: write test → run → fix until it passes |
| `/workflow <id> <task>` | Run a predefined multi-step workflow |
| `/agent <task>` | Full agentic run with all tools |
| `/new` | Start a fresh conversation (clears context) |
| `/resume [id\|index]` | Reopen a past conversation |
| `/rollback` | Undo all changes made since your last message |
| `/<yourPrompt>` | Any prompt you saved in **Settings → Prompts** |

### Mentions & tool commands (type inside a message)

| Syntax | Purpose |
|---|---|
| `@file:<path>` | Inject a file's content into the request |
| `@docs:<query>` | Semantic (RAG) search over your indexed docs/code |
| `@read <path>` | Print a file's contents (no model) |
| `@list [path]` | List a directory (no model) |
| `@write <path> <content>` | Write a file (no model, HITL-gated) |
| `@run <cmd>` | Run a terminal command (no model, HITL-gated) |
| `@QA-Agent` · `@Doc-Agent` · `@Refactor-Agent` · `@Security-Agent` · `@Perf-Agent` | Delegate to a specialized agent |

> The chat input has built-in autocomplete: type `/` at the start of the line for slash commands, or `@` (at the start or after a space) for mentions and tool commands.

---

<div align="center">
  <sub>Jarvis Agent is free and open source — <a href="https://github.com/maxoubvd/extension-VS-code">GitHub</a> · <a href="https://github.com/maxoubvd/extension-VS-code/issues">Issues</a> · <a href="../../CHANGELOG.md">Changelog</a></sub>
</div>
