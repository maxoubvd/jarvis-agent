# Getting Started

← [Back to the User Guide](README.md)

This page gets you from zero to your first Jarvis conversation.

---

## 1. Install

Install **Jarvis Agent** from the VS Code Marketplace (the Marketplace listing is titled **"Jarvis Code Agent"**, publisher **MaximeBendavid**). It's free and MIT-licensed.

**Requirements:**
- VS Code `1.90.0` or newer.
- A **trusted workspace**. Jarvis's agent tools (terminal execution, file read/write) are disabled in Restricted Mode — open your folder as trusted so the agent can work.

---

## 2. Open the chat

There are two ways to open the Jarvis sidebar:

- Click the **Jarvis icon** in the VS Code Activity Bar (left edge). The panel is titled **"Jarvis Chat"**.
- Or run the command **`Jarvis: Start Chat`** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

The first time it opens, a **Welcome screen** walks you through configuring your first model.

---

## 3. Connect a model

Jarvis is **model-agnostic** — you pick the "brain" behind the agent. Configure models in the **Settings** tab of the sidebar (**Settings → Models**). You can add several models and tag each one for a role (see [Model roles](chat-modes-and-settings.md#model-roles)).

### Option A — Local (free & private)

No API key, nothing leaves your machine.

| Provider | Notes |
|---|---|
| **Ollama** | One-click connect. Recommended models: `qwen2.5-coder:7b`, `llama3:8b`. |
| **LM Studio** | Point Jarvis at your local LM Studio server. |

> **Note on local models:** small models (Ollama / LM Studio, or any model whose name contains `7b`/`8b`) are automatically switched to **Fast mode** and have **Plan mode** hidden, because they handle single-shot tasks better than long agentic loops. See [Chat Modes](chat-modes-and-settings.md#chat-modes).

### Option B — Cloud (maximum performance)

Add an API key in **Settings → Models**. Supported providers:

| Provider | Type |
|---|---|
| **OpenRouter** | Access to many hosted models via one key |
| **Mistral AI** | Direct Mistral API |
| **OpenAI-compatible** | Generic wrapper that also covers **OpenAI**, **Anthropic**, **Gemini**, **SambaNova**, and **Hugging Face** |

> **Tip:** For strong, low-latency performance completely free, connect **Mistral AI** directly — create a free API key at [console.mistral.ai](https://console.mistral.ai/).

### Privacy note

When you use a **cloud** provider, outgoing prompts are passed through a **secret scrubber** that removes API keys, tokens, private keys, and similar secrets before they leave your machine. Local providers are not scrubbed by default. See [Secret scrubbing](chat-modes-and-settings.md#secret-scrubbing).

---

## 4. Send your first message

Type a request in the chat input and press `Enter`. A few good first messages:

```
Explain what this project does and how it's structured.
```

```
Add input validation to the function I have selected.
```

```
@file:package.json  What scripts can I run?
```

By default Jarvis runs in **Automatic** mode: it decides whether to answer directly, use its tools (read/edit files, run commands), or draft a plan first. You can change this per-message with `Shift+Tab` — see [Chat Modes](chat-modes-and-settings.md#chat-modes).

---

## 5. Recommended next step: initialize the project

Run **`/init`** once per project. Jarvis initializes git (if needed), analyzes your codebase, and writes a **`JARVIS.md`** file at the workspace root. This file is injected into every future request, so Jarvis always knows your build commands, architecture, and conventions — and because it's committed with your code, the whole team benefits. See [`/init`](chat-commands.md#init).

---

## Where to go next

- **[Chat Commands & Mentions](chat-commands.md)** — the full command vocabulary.
- **[Keyboard Shortcuts & Controls](shortcuts.md)** — Inline Edit, autocomplete, mode cycling.
- **[Tips & Best Practices](tips.md)** — get the most out of Jarvis.
