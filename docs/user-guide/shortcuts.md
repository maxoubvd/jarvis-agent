# Keyboard Shortcuts & Controls

← [Back to the User Guide](README.md)

Every key, button, and Command Palette entry Jarvis provides.

- [Keyboard shortcuts](#keyboard-shortcuts)
- [In-editor controls (Inline Edit & CodeLens)](#in-editor-controls)
- [Chat panel controls](#chat-panel-controls)
- [Per-message actions (Rewind / Fork)](#per-message-actions)
- [Command Palette commands](#command-palette-commands)
- [Explorer context menu](#explorer-context-menu)

---

## Keyboard shortcuts

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl+K Ctrl+K` (Win/Linux) · `Cmd+K Cmd+K` (Mac) | Code editor with focus | **Inline Edit** — see below |
| `Tab` | Code editor | Accept the inline autocomplete ghost-text suggestion *(only when autocomplete is enabled)* |
| `Shift+Tab` | Chat input | Cycle the chat mode: **Automatic → Fast → Plan** |
| `↑` / `↓` | Chat input (when empty) | Recall your previous / next messages |

> `Ctrl+K Ctrl+K` / `Cmd+K Cmd+K` is a **chord** (press the combo twice in a row). It's the only key binding Jarvis declares, and it can be rebound in VS Code's **Keyboard Shortcuts** editor under command `jarvis.inlineEdit`. The other rows are behaviors of the chat input or of VS Code's native autocomplete, not rebindable Jarvis keybindings.

---

## In-editor controls

### Inline Edit (`Ctrl+K Ctrl+K` / `Cmd+K Cmd+K`)

**Description.** Select a block of code in the editor, press the chord, and describe the change in the input box that appears (title *"Jarvis Inline Edit"*). Jarvis rewrites the selection in place while showing progress. Requires an active editor with a **non-empty selection**.

**Example prompt:** *"Add robust error handling to this function."* or *"Translate these comments to English."*

Also available as the Command Palette command **`Jarvis: Inline Edit (Cmd+K)`**.

### CodeLens: Accept / Reject changes

**Description.** When the agent edits a file, inline **CodeLens buttons** appear so you can review changes without leaving the editor:

| CodeLens | Location | Action |
|---|---|---|
| **✓ Accept Hunk** / **✗ Reject Hunk** | Above each changed block | Keep or discard that one hunk |
| **✓ Accept All Changes** / **✗ Reject All Changes** | Top of the file | Keep or discard every change in the file |

Edited files also show **green/red decorations** marking additions and removals. You can accept/reject everything across all files at once with the `Jarvis: Accept All AI Changes` / `Jarvis: Reject All AI Changes` commands.

---

## Chat panel controls

| Control | Action |
|---|---|
| **Mode selector** (or `Shift+Tab`) | Switch between **Automatic**, **Fast**, and **Plan** modes — see [Chat Modes](chat-modes-and-settings.md#chat-modes) |
| **Stop button (■)** | Interrupt the running agent and cancel the current request — use it if a task is stuck or taking too long |
| **Proceed button** | Appears after a **Plan** is produced; approves the plan and runs it with full tools |
| **Copy** on code blocks | Click any code block to copy it |
| **Collapsible messages** | Long messages (over ~600 characters or 8 lines) and `<thinking>` sections collapse to keep the transcript readable |
| **Tabs** | Switch between **Chat**, **Checkpoints**, **Analytics**, and **Settings** |

---

## Per-message actions

Each of your past messages has a small actions menu. Because a checkpoint is linked to each agentic turn, you can rewind the code, the conversation, or both:

| Action | What it restores | Touches files on disk? |
|---|---|---|
| **Rewind to message** | The **code/files** to the checkpoint captured just before that turn ran | ✅ Yes (restores files) |
| **Fork conversation** | The **conversation** — truncates to just before that message so you can edit and resend it; the original is preserved as a past session | ❌ No |
| **Fork and rewind** | **Both** — rewinds the code, then forks the conversation | ✅ Yes |

> Rewind requires a checkpoint linked to that message (every agentic turn creates one). Plain text-only replies have no checkpoint to rewind to.

---

## Command Palette commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Jarvis". All commands:

| Command | Action |
|---|---|
| **Jarvis: Start Chat** | Open the Jarvis sidebar / focus the chat |
| **Jarvis: Initialize Project (generate JARVIS.md)** | Run [`/init`](chat-commands.md#init) — analyze the project and write `JARVIS.md` |
| **Jarvis: Inline Edit (Cmd+K)** | Edit the current editor selection (same as the chord) |
| **Jarvis: Rollback to Checkpoint** | Open the rollback panel to restore any checkpoint |
| **Jarvis: List Checkpoints** | List all saved checkpoints |
| **Jarvis: Index Workspace (RAG)** | Rebuild the semantic search index over your files |
| **Jarvis: Export Analytics** | Export your usage analytics |
| **Jarvis: Generate .jarvisignore** | (Re)generate the `.jarvisignore` sandbox file |
| **Jarvis: Add to .jarvisignore** | Add a path to `.jarvisignore` |
| **Jarvis: Remove from .jarvisignore** | Remove a path from `.jarvisignore` |
| **Jarvis: Accept All AI Changes** | Accept every pending AI edit across all files |
| **Jarvis: Reject All AI Changes** | Reject every pending AI edit across all files |

---

## Explorer context menu

Right-click any file or folder in the VS Code **Explorer** to get:

- **Jarvis: Add to .jarvisignore** — quickly exclude a sensitive file/folder from the agent's sandbox. See [Sandbox & .jarvisignore](chat-modes-and-settings.md#sandbox--jarvisignore).

---

## Related pages

- **[Chat Modes & Settings](chat-modes-and-settings.md)** — what each mode and setting does.
- **[Chat Commands & Mentions](chat-commands.md)** — the typed-command equivalents.
