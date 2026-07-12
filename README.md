<div align="center">
  <style>
    .jarvis-logo {
      border-radius: 16px;
      transition: all 0.3s ease;
    }
    .jarvis-logo:hover {
      transform: scale(1.05);
      box-shadow: 0 0 20px rgba(0,0,0,0.2);
    }
  </style>
  <img class="jarvis-logo" src="media/jarvis-icon.png" alt="Jarvis Agent Logo" width="128"/>
  <h1>Jarvis Agent</h1>
  <p><strong>Your autonomous software engineer, right inside VS Code.</strong></p>
</div>

---

**Jarvis Agent** is a next-generation extension for Visual Studio Code. Whether you want to automate component creation, debug a complex system, or explore a huge codebase, Jarvis integrates seamlessly into your local environment to assist you.

---

<div align="center" style="margin: 20px 0;">
  <video controls width="800" style="border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
    <source src="media/user_guide_jarvis.mp4" type="video/mp4">
    Your browser does not support the video tag.
  </video>
  <p><strong>Here is an example of what you can do with Jarvis Agent.</strong></p>
</div>

## ✨ Key Features

### 1. Inline Editing (Cmd+K)
Select any block of code, press `Cmd+K Cmd+K` (or `Ctrl+K Ctrl+K` on Windows/Linux), and give Jarvis an instruction (e.g. *"Add robust error handling to this function"*).

The AI writes the code live, and **CodeLens (`✓ Accept` / `✗ Reject`)** lets you approve or reject the change line by line.

### 2. Context Understanding (RAG & AST Pruning)
Jarvis doesn't suffer from the typical token limits of other AIs:
- **@file**: Instantly reference specific files in your requests.
- **Semantic RAG (`@docs`)**: Search your documentation and entire project by concept, not just by keyword.
- **AST Pruning**: Jarvis analyzes syntactic structure (with `tree-sitter`) to read only the important functions of a giant file without saturating the context.

### 3. Autonomous Execution (Terminal & TDD)
Jarvis doesn't just write code, it runs it.
- **TDD Workflow**: Type `/tdd write me a fibonacci function` and Jarvis will write the test, try to run it, see the error, write the implementation, and verify the test passes.
- **Integrated Terminal**: The agent can run `npm install`, `git commit`, or `cargo build`. **Human-in-the-Loop (HITL)**: in strict mode, it asks for your permission first.

### 4. Connected to Everything (MCP Standard)
Thanks to the **Model Context Protocol (MCP)**, Jarvis can use external tools. Connect it to GitHub, a PostgreSQL database, or a third-party MCP server directly from the Settings tab. The built-in **web search** (`search_web`) is powered by **DuckDuckGo** — entirely free, no API key or account needed — with configurable default sources (StackOverflow, MDN, GitHub, or your own domains).

### 5. Specialized Agents & Project Instructions
- **5 dedicated agents** (`@QA-Agent`, `@Doc-Agent`, `@Refactor-Agent`, `@Security-Agent`, `@Perf-Agent`), each with tool access genuinely restricted to its role — `@Security-Agent` audits read-only, `@QA-Agent` runs tests without ever editing code.
- **`JARVIS.md`**: type `/init` (or `Jarvis: Initialize Project` in the command palette) so Jarvis initializes git if needed, analyzes your project, and generates an instructions file versioned with the code — shared with the whole team, unlike personal rules.
- **Folder-scoped rules**: scope a rule to a subfolder (`src/backend/**`) so it only applies to the relevant files.
- **Persistent task checklist** above the chat, auto-filled for `/workflow` runs.
- **Auto-open** of the file being edited, with green/red decorations already in place.
- **Inline autocomplete (Tab)** Copilot/Continue-style — disabled by default, enable it in Settings > Optimization.

---

## 🚀 Installation & Quick Start

1. Install **Jarvis Agent** from the VS Code Marketplace.
2. Click the Jarvis icon in the left sidebar (or run the `Jarvis: Start Chat` command).
3. The **Welcome screen** will guide you through configuring your first model!

### Provider Compatibility
Jarvis is **agnostic**. You choose the brain behind your agent:
- **Local (Free & Private)**: Connect **Ollama** or **LM Studio** in one click. We recommend recent models like `qwen2.5-coder:7b` or `llama3:8b`.
- **Cloud (Ultra Performant)**: Use the APIs of **OpenRouter**, **OpenAI**, **Anthropic**, or **HuggingFace** to take advantage of GPT-4o or Claude 3.5 Sonnet. For excellent performance completely free with no latency, we recommend **Mistral AI** models directly from the Mistral provider. Create a free API key [here](https://console.mistral.ai/).

---

## 📖 Advanced User Guide

### Chat Modes
- **Automatic**: Jarvis analyzes the model's size and the task's complexity to choose between a plain text answer or a decomposition workflow (Task Decomposer).
- **Fast**: Quick text-only replies, no tool execution.
- **Plan**: Jarvis always creates a Markdown plan (`implementation_plan.md`) for you to validate the architecture before it touches any code.

### Keyboard Shortcuts
- `Cmd+K Cmd+K` (Mac) or `Ctrl+K Ctrl+K` (Win): Inline editing of a code selection.
- `Tab`: Accepts an inline autocomplete suggestion (if enabled in Settings > Optimization).
- `/new`: Starts a new conversation (clears context).
- `/init`: Initializes git if needed and generates `JARVIS.md` from a project analysis.
- `/rollback`: Opens the "Checkpoints" list to fully undo Jarvis's impact on your project.

### **"Kill Switch"** Button
If Jarvis goes off the rails or a command execution loops forever, use the stop button (Square) in the chat panel to stop the agent immediately and cut the network connection.

---

## ⚙️ Advanced Settings & Configuration

All configuration is stored in `~/.jarvis/config.json` (+ an optional per-workspace override in `jarvis/jarvis-config.json`).
You can configure Jarvis visually via the **Settings** tab:
- Adjust verbosity (Concise / Detailed).
- Hide or show the agent's thoughts.
- Manage `jarvisignore` to prevent access to certain sensitive folders.
- Configure MCP server profiles.
- Configure your default sources for web search (free via DuckDuckGo, no key required).
- Customize specialized agents (system prompt + allowed tools) and rules (global or folder-scoped).
- Enable auto-open of the edited file (`always`/`never`/`strict-hitl-only`) and inline autocomplete (disabled by default).

---

## 🤝 Contributing & Support
Jarvis is a community project, built by developers, for developers.
- Ideas, bugs? Open an [Issue on GitHub](https://github.com/maxoubvd/extension-VS-code/issues).
- Want to contribute? Pull Requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).
- Change history: see [CHANGELOG.md](CHANGELOG.md).

<div align="center">
  <p>Made for the VS Code community.</p>
</div>
