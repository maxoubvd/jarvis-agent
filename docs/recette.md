# Test Book (Recette) - Jarvis Agent

This document lists the full set of test scenarios to ensure all parts of the Jarvis extension work correctly. Follow these steps in order to validate the architecture and use cases.

---

## 1. Setup and Models (Providers)

### 1.1 Remote model (e.g. OpenAI / OpenRouter)
- [X] **Action**: In the webview's "Settings" tab, configure a provider (e.g. OpenAI), add a valid API key, and select a model (e.g. `gpt-4o`).
- [X] **Test**: Ask a simple question like "Hello, who are you?".
- [X] **Expected result**: Jarvis responds quickly, identifying itself as a coding assistant.

### 1.2 Local model (Ollama / LMStudio)
- [X] **Action**: Start Ollama with a model (e.g. `ollama run llama3:8b`). In Jarvis Settings, add an Ollama provider (default URL `http://localhost:11434`), and select the `llama3:8b` model.
- [X] **Test**: Ask a question in the chat in "Fast" mode.
- [X] **Expected result**: The local model responds. No network error appears.

---

## 2. Chat Modes and Smart Routing

### 2.1 Fast mode
- [X] **Action**: Select "Fast" mode. Ask "Give me a function to add two numbers in JS".
- [X] **Expected result**: Jarvis gives the code as text. It doesn't try to run tools or create files.

### 2.2 Plan mode (strict workflow)
- [X] **Action**: Select "Plan" mode. Ask "I want to build an API with Express".
- [X] **Expected result**: Jarvis writes no direct code. It uses the write tool to generate an `implementation_plan.md` file describing the steps, then asks "Does my plan work for you?" in the chat.

### 2.3 Automatic mode (small model + dynamic routing)
- [X] **Action**: Enable a small local model (e.g. Ollama `llama3:8b`) or a model containing "7b"/"8b". Make sure you're in "Automatic" mode. Ask "Create a complete React Button component for me".
- [X] **Expected result**: The extension detects the presence of a small model and triggers the `dynamic` workflow. In the chat or via step logs, you should see the *Task Decomposer* create sub-steps (Analysis, Execution, Test) and validate them sequentially.

### 2.4 Automatic mode (large model)
- [X] **Action**: Enable a powerful model (GPT-4, Claude-3.5-Sonnet) in "Automatic" mode. Give a simple coding instruction.
- [X] **Expected result**: The model uses its tools directly (classic agentic loop) without going through the `dynamic` decomposition workflow.

---

## 3. Diff Review and CodeLens (File Modifications)

### 3.1 Editing and CodeLens appearance
- [X] **Action**: Ask Jarvis to modify an existing file (e.g. "Add a comment at the top of index.ts").
- [X] **Expected result**: The file is edited. VS Code instantly shows a green background on the newly added line. Above the change, the clickable CodeLens `✓ Accept Hunk` and `✗ Reject Hunk` appear. (At the top of the file, `✓ Accept All Changes` should appear.)

### 3.2 Accepting via CodeLens
- [X] **Action**: Click `✓ Accept Hunk` in the editor.
- [X] **Expected result**: The green background disappears. The clickable CodeLens text disappears. The file is considered validated and saved.

### 3.3 Rejecting via CodeLens
- [X] **Action**: Ask for another change. Click `✗ Reject Hunk`.
- [X] **Expected result**: The text added by the AI immediately disappears from the editor. The file returns to its original state.

### 3.4 Inline editing (Cmd+K)
- [X] **Action**: In an open file, select a function, then press `Ctrl+K Ctrl+K` (or `Cmd+K Cmd+K` on Mac). Enter a prompt (e.g. "Add a try/catch").
- [X] **Expected result**: Jarvis activates, understands the context of the selection, and applies the change directly in the editor via the editing tools. The diff acceptance buttons appear.

---

## 4. Context, Semantic RAG, and Tree-Sitter (Pruning)

### 4.1 `@file:` mention
- [X] **Action**: In the chat, type "What does the main function do in @file:src/index.ts".
- [X] **Expected result**: The content of `src/index.ts` is read and injected. Jarvis correctly explains the code.

### 4.2 RAG (Semantic Search) with `@docs:`
- [X] **Prerequisite**: Use the `Jarvis: Index Workspace (RAG)` command from the VS Code palette (Ctrl+Shift+P) to vectorize the project. Wait for the success notification.
- [X] **Action**: Type an approximate semantic query: "How is the user interface handled @docs:".
- [X] **Expected result**: Without an exact keyword match, the `@xenova/transformers` library (all-MiniLM-L6-v2) finds the relevant files via cosine embeddings. Jarvis uses this context to answer.

### 4.3 Context Pruning (AST Tree-Sitter)
- [X] **Action**: Ask Jarvis to analyze a huge TS file (> 1000 lines) containing many functions, telling it to focus on ONE specific function.
- [X] **Expected result**: The agent should read the file, and thanks to `web-tree-sitter`, prune unnecessary functions (keeping only their signatures) to read only the body of the targeted function, drastically reducing token consumption visible in the gauge.

---

## 5. Terminal Command Execution and HITL (Human In The Loop)

### 5.1 Strict mode
- [X] **Action**: In the settings, set `jarvis.hitl.mode` to `strict`. Ask "Run ls -la".
- [X] **Expected result**: Before executing the command in the terminal, an approval interface appears. The "Allow" button must be clicked for the command to run.

### 5.2 Moderate mode
- [X] **Action**: Switch to `moderate` mode. Ask for an `ls -la`.
- [X] **Expected result**: The harmless `ls` command runs silently and Jarvis gives you the result.
- [X] **Action**: Ask "Delete the toto.txt file with rm".
- [X] **Expected result**: The destructive command blocks execution and asks for formal approval via the Webview or a notification.

---

## 6. Auto-TDD Loop

### 6.1 Launching a TDD loop
- [X] **Action**: In the chat, type the command `/tdd write me a fibonacci function in fib.ts`.
- [X] **Expected result**:
  1. The agent creates the unit test for Fibonacci (in a `.test.ts` or `.spec.ts` file).
  2. The agent runs the tests in the background (the `npm test` command configured in `jarvis.tdd.testCommand` will fail because the implementation is missing).
  3. It observes the failure.
  4. The agent writes the implementation of `fib.ts`.
  5. It reruns the tests, which should now pass.
  6. The loop ends with a summary.

---

## 7. Utility Features

### 7.1 Token Gauge (Status Bar)
- [X] **Action**: Chat and use context.
- [X] **Expected result**: At the bottom right of the VS Code editor, the status bar `$(hubot) Jarvis X%` increments. Hovering with the mouse shows In/Out tokens. Past a critical threshold (80%), it turns orange/red.

### 7.2 Checkpoints and Rollback
- [X] **Action**: Make several requests that modify the project. Then use the `Jarvis: List Checkpoints` command or `/rollback`.
- [X] **Expected result**: A list of git (or internal) backups appears. Selecting a previous checkpoint restores the files to their exact state at that moment.

### 7.3 `.jarvisignore`
- [X] **Action**: Use `Jarvis: Generate .jarvisignore` to create the file. Add a sensitive directory to it (e.g. `secrets/`). Ask Jarvis to list the project's files.
- [X] **Expected result**: Jarvis's `list_dir` tool is blind to the `secrets/` folder and refuses to access it, even via an explicit file read.

### 7.4 MCP Protocol (External Servers)
- [X] **Action**: Go to Settings > MCP. Add an external MCP server (for example the local "sqlite" or "brave-search" server).
- [X] **Expected result**: The server initializes. If you ask the Agent "Use Brave Search to look up today's news", it will automatically use the tool provided by the MCP server.

---

## 8. Webview Interface (UI)

### 8.1 Markdown and Code Highlighting
- [X] **Action**: Ask for Python, HTML, and Rust code.
- [X] **Expected result**: The code is correctly highlighted in the Chat (PrismJS) with a working copy button ("Copy to clipboard").

### 8.2 Cancel Button (Kill Switch)
- [X] **Action**: Ask the AI to write a very long script or trigger a complex agent loop. While the AI is generating its response, click the "Stop" (square) button that replaced the send button.
- [X] **Expected result**: Generation stops instantly, the network call is aborted (`AbortController`), and the interface becomes available again for a new message.

### 8.3 Navigation
- [X] **Action**: Switch from the Chat tab to the Settings tab, then Analytics.
- [X] **Expected result**: The transition is smooth (no full page reload). Settings retain their values.

---

## 9. Onboarding (Welcome Screen)

### 9.1 First launch (no model)
- [X] **Prerequisite**: Empty or delete `~/.jarvis/config.json` (no model configured), then launch the Extension Development Host (`F5`).
- [X] **Action**: Open the Jarvis panel.
- [X] **Expected result**: Instead of the simple "No model configured" banner, a **full-panel Welcome screen** appears: title, step indicator (Provider → Connection → Tour), and a grid of providers (Ollama, OpenRouter, OpenAI, Anthropic, Mistral, LM Studio).

### 9.2 Testing a provider connection
- [X] **Action**: Choose a provider (e.g. Ollama), fill in a model (e.g. `qwen2.5-coder:7b`), click "Continue" then "Test connection".
- [X] **Expected result**: A "ping" is sent via an ephemeral provider. On success, a green "Connection successful" banner appears. On error (invalid key, server down), a red banner shows the error message. The config is NOT yet saved at this stage.

### 9.3 Visual tour of the 3 features
- [X] **Action**: Click "Save and continue". The model is persisted (via `updateSettings`) and becomes the default model. The tour starts.
- [X] **Expected result**: Three successive slides present **the agentic Chat**, **inline Cmd+K editing**, and **@mentions** (`@file:` / `@docs:`). Navigation (dots + Previous/Next) works. The final "Start coding" button closes the screen and opens the chat.

### 9.4 Not reappearing after completion
- [X] **Action**: Reload the window (`Developer: Reload Window`).
- [X] **Expected result**: The Welcome screen **does not reappear** (the `jarvis.onboardingDone` state is stored in `globalState`). The chat opens directly. (A user who is already configured lands directly on the tour the 1st time, then never again.)

---

## 10. Prompt Caching (implicit + stats)

### 10.1 "Cached" tokens visible in the gauge
- [X] **Prerequisite**: A cloud model with implicit caching (OpenAI `gpt-4o-mini`, DeepSeek via OpenRouter…).
- [X] **Action**: Send a first long message (large context: rules + files). Then, in the same conversation, send a second message that reuses the same system prefix.
- [X] **Expected result**: Expand the token gauge ("Tokens used"). Starting from the 2nd message, a green **"⚡ Cached: N"** line appears, indicating the prompt tokens served from the provider's cache (from `usage.prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens`).

### 10.2 Reduced latency on a stable prefix
- [X] **Action**: Compare the time to first response between the 1st call (cold cache) and subsequent ones (warm cache).
- [X] **Expected result**: Calls reusing the stable prefix (system prompt + rules) respond faster. No manual setting: the cache is managed on the API side as long as the prefix stays identical from one turn to the next.

---

## 11. Structured Outputs (JSON Mode)

### 11.1 Agent loop without parsing breakage
- [X] **Prerequisite**: A small local model (e.g. Ollama `llama3:8b` or `qwen2.5-coder:7b`).
- [X] **Action**: Run `/agent create a React Button component` (or an Automatic mode triggering the orchestrator).
- [X] **Expected result**: The agent loop's model calls send `response_format: {type:'json_object'}` (OpenAI-compatible) or `format:'json'` (Ollama). The model consistently returns parsable JSON; **no "Unexpected format" error** interrupts the tool chain. `json-cleaner` remains a safety net.

### 11.2 Automatic fallback if unsupported
- [X] **Action**: Use an endpoint that rejects `response_format` (some older OpenAI-compatible servers).
- [X] **Expected result**: On the first rejection (HTTP 400 mentioning `response_format`/`json`), the orchestrator **disables JSON mode for that provider** (remembered), logs "JSON mode not supported… falling back to prompt" in the OutputChannel, and **replays the iteration without the option**. The loop continues normally, without a costly new attempt on subsequent requests.

---

## 12. Session Persistence (Gauge & History)

### 12.1 Gauge restored after Reload Window
- [X] **Action**: Chat until the gauge goes up (tokens > 0), then `Developer: Reload Window`.
- [X] **Expected result**: After reloading, the **token gauge keeps its value** (input/output/cached + history of the last 5 requests), restored from `workspaceState` (`jarvis.tokenState`).

### 12.2 Chat history restored
- [X] **Action**: After the reload, look at the chat panel.
- [X] **Expected result**: The **messages from the ongoing conversation reappear** (rehydrated from `SessionStore` / `.vscode/jarvis-sessions.json`). The conversation can continue with the previous context.

### 12.3 Persistence after a full restart
- [X] **Action**: Fully close VS Code then reopen the same workspace.
- [X] **Expected result**: Gauge and history are still present (`workspaceState` survives the restart). `/new` resets both the gauge AND the persisted snapshot.

---

---

## 13. V1 Finalization (2026-07-11 audit)

Scenarios covering the 9 finalization workstreams from `docs/audit-2026-07-11.md`. Run after a clean `npm run build` (backend + webview).

### 13.1 Specialized agents — real tool restriction

- [X] **Action**: Type `@Security-Agent audit this file and fix the flaws you find` on a file containing an obvious issue (e.g. a hardcoded secret).
- [X] **Expected result**: The agent reads the code and lists the issues, but **never attempts** to call `edit_existing_file`/`create_new_file`/`run_terminal_command` (it doesn't have those tools — if the model tries, the orchestrator returns "Unknown tool"). It suggests the fix as text rather than applying it.
- [X] **Action**: Type `@QA-Agent run the project's tests and summarize the failures`.
- [X] **Expected result**: The agent uses `run_terminal_command`/`grep_search` without editing any file.
- [X] **Action**: In Settings > Agents, expand an agent and check the "Allowed tools" field — edit it (e.g. remove `run_terminal_command` from QA-Agent), save, then ask that agent for a task again.
- [X] **Expected result**: The change takes effect immediately (no need to reload the window).

### 13.2 Auto-opening the edited file

- [X] **Action**: Ask the agent to modify 2-3 different files in the same task (e.g. "rename function foo to bar in these 3 files").
- [X] **Expected result**: After each edit, the file in question opens in the foreground in the editor (italicized tab = "preview"), and the green/red decorations are visible. A single preview tab is reused for each subsequent edit (no stacking of 3 separate tabs).
- [X] **Action**: In Settings > Optimization, set "Auto-open edited files" to `never`, then request another edit.
- [X] **Expected result**: The file is no longer automatically brought to the foreground (you must still accept/reject via the diff review panel in the chat, which remains unchanged).

### 13.3 Web Search (DuckDuckGo, free)

- [ ] **Prerequisite**: none — no API key, no account to create.
- [ ] **Action**: Ask "Search the web for the latest stable version of Svelte".
- [ ] **Expected result**: The agent calls `search_web` and gets real results (titles + links + snippets), not an error message.
- [ ] **Action**: In Settings > Web Search, check "stackoverflow.com" as a default source, then request a search again without specifying a site.
- [ ] **Expected result**: The results are restricted to StackOverflow (verifiable in the returned URLs).

### 13.4 `JARVIS.md` and the `/init` command

- [X] **Action**: On a folder that isn't a git repo yet, type `/init` in the chat.
- [X] **Expected result**: A dialog asks for confirmation to `git init`; after accepting, a `.git` folder appears, then the agent analyzes the project and creates `JARVIS.md` at the root with the Project Overview / Build & Test Commands / Architecture / Conventions / Notes for Agents sections.
- [X] **Action**: Rerun `/init` while `JARVIS.md` already exists.
- [X] **Expected result**: A confirmation is requested before overwriting the existing file; if declined, the file remains unchanged.
- [X] **Action**: Manually edit `JARVIS.md` to add a distinctive instruction (e.g. "Always answer starting with 🚀"), then ask a question in the chat.
- [X] **Expected result**: The agent follows the instruction — confirming that `JARVIS.md` is indeed injected into the system prompt (agents, workflows, and direct chat).
- [X] **Palette test**: `Ctrl+Shift+P` → `Jarvis: Initialize Project (generate JARVIS.md)`.
- [X] **Expected result**: Opens the sidebar and triggers `/init` as above.

### 13.5 Folder-scoped rules

- [X] **Action**: In Settings > Rules, create a "Backend only" rule with the content "Always use relative imports with a .js suffix" and a scope of `packages/core/**`.
- [X] **Action**: Open a file in `packages/core/src/`, ask the agent a general question (any one, to verify the prompt injection).
- [X] **Expected result**: The rule applies (visible if you ask the agent to quote its instructions, or observable in the style of the generated code).
- [X] **Action**: Open a file in `src/frontend/` instead, ask a question again.
- [X] **Expected result**: The rule scoped to `packages/core/**` no longer applies.

### 13.6 Visual TODO checklist

- [X] **Action**: Run `/workflow dev-feature add a date-formatting utility function`.
- [X] **Expected result**: **Even before the first step begins**, a "Tasks (0/4)" checklist appears above the input box with the workflow's 4 steps (Plan/Code/Test/Commit). Each step moves to "in_progress" then "completed" as it progresses.
- [X] **Action**: Once the workflow is finished, type `/new`.
- [X] **Expected result**: The checklist disappears.
- [X] **Action**: Run a simple agentic task (`/agent ...`) on a model that supports tool calls well, explicitly asking it to "break the task into steps with the checklist".
- [X] **Expected result**: The model can call the `update_todo_list` tool and the checklist appears/updates without ever asking for HITL confirmation (even in strict mode).

### 13.7 Inline autocomplete (Tab)

- [X] **Prerequisite**: In Settings > Optimization, enable "Inline autocomplete (Tab)" (disabled by default).
- [X] **Action**: Open a code file, place the cursor at the end of an incomplete line (e.g. `const total = `), wait ~0.5s without typing.
- [X] **Expected result**: Grayed-out ghost text appears suggesting a completion; `Tab` accepts it, `Escape` or continuing to type cancels it.
- [X] **Action**: Keep typing quickly without pausing.
- [X] **Expected result**: No request is triggered while you're typing (debounce) — no ghost text flickering on every keystroke.
- [X] **Action**: Disable the setting, retest.
- [X] **Expected result**: No completion triggers anymore.
- [X] **Optional**: In Settings > Models, tag a fast local model (e.g. Ollama `qwen2.5-coder:7b`) with the `autocomplete` role, then retest.
- [X] **Expected result**: Completions use that model instead of the default chat model.

### 13.8 UI Cleanup (non-regression)

- [X] **Action**: In Settings > Models, expand a model and look at the role toggles.
- [X] **Expected result**: Only `chat`, `edit`, `apply`, `autocomplete` are offered (no more `embed`/`rerank`/`summarize`).
- [X] **Action**: Change the HITL mode in Settings (Optimization > HITL mode) without clicking "Save".
- [X] **Expected result**: The change is applied immediately (visible in the approval behavior of the next terminal command), not only after saving.
- [X] **Action**: Clear the chat (no messages), observe the empty state.
- [X] **Expected result**: Two buttons, "New chat" / "Resume past conversation", are visible and functional.
- [X] **Action**: Switch to "Plan" mode, let the agent propose a plan.
- [X] **Expected result**: The "Review" button shows the correct pencil icon (no more generic circle); same for the "Working..." badge (chip icon) and the stop button (square icon).
- [X] **Action**: In Settings > Models, select the "huggingface" provider.
- [X] **Expected result**: The "API base URL" field pre-fills correctly (no more empty/`undefined` field).

---

## 14. Jarvis CLI (terminal front-end)

Prerequisite: `npm install && npm run build:cli`, then run from a project directory
(`node packages/cli/dist/cli.js`, or `jarvis` once installed globally).

### 14.1 Home page & navigation
- [ ] **Action**: Run `jarvis` with no arguments.
- [ ] **Expected result**: The red JARVIS wordmark + gold subtitle appear, followed by the active model & provider, the workspace path, the HITL mode, and the command hints. Then the REPL prompt is shown.
- [ ] **Action**: With no model configured, run `jarvis`.
- [ ] **Expected result**: A red "no model configured" status and a prompt to run `jarvis settings`.
- [ ] **Action**: Run `jarvis --help` then `jarvis --version`.
- [ ] **Expected result**: The command list / the version, then a clean exit (no REPL).

### 14.2 Config parity with the extension
- [ ] **Action**: Run `jarvis settings` > Models > add a model and set it as default.
- [ ] **Expected result**: `~/.jarvis/config.json` is updated; **opening the extension's Settings tab shows the same model**, and vice-versa.
- [ ] **Action**: In `jarvis settings` > Approvals, switch to `strict`.
- [ ] **Expected result**: The change persists and the next terminal command in the REPL asks for approval.

### 14.3 Chat, agent & tools
- [ ] **Action**: In the REPL, ask a question that requires reading a file.
- [ ] **Expected result**: Tool calls stream live (gold `⚙` lines with ✓/✗ results), then the final answer is rendered as formatted Markdown, followed by a token count.
- [ ] **Action**: `/mode fast` then ask a plain question.
- [ ] **Expected result**: The answer streams directly with no tool calls.
- [ ] **Action**: Run a request that triggers a terminal command.
- [ ] **Expected result**: An inline approval prompt offers **Allow once / Allow for this session / Deny**; denying lets you type guidance that the agent then follows.
- [ ] **Action**: Use `@file:<path>` and an `@QA-Agent` mention.
- [ ] **Expected result**: The file content is injected as context; the specialized agent runs with its restricted tool set.

### 14.4 Sub-commands
- [ ] **Action**: `jarvis "list the top-level folders of this project"` (one-shot).
- [ ] **Expected result**: It runs once, prints the answer, and exits without entering the REPL.
- [ ] **Action**: `jarvis checkpoints`, then `/rollback` inside the REPL.
- [ ] **Expected result**: Checkpoints are listed; rollback reports success or a clear error.
- [ ] **Action**: `/tdd <small task>` and `/workflow dev-feature <task>`.
- [ ] **Expected result**: The TDD loop reports attempts and pass/fail; the workflow announces each step.

### 14.5 Host isolation (non-regression of the extraction)
- [ ] **Action**: Run `npm run build:cli`.
- [ ] **Expected result**: The build **succeeds** — proving no `vscode` import leaked into the shared core (the build intentionally does not mark `vscode` as external).
- [ ] **Action**: Run `npm run build` and press `F5`.
- [ ] **Expected result**: The extension still builds and behaves exactly as before the monorepo extraction (chat, agent, tools, diff review, checkpoints).

---

**Test book closed.** If all these steps work as expected, the extension is robust, **ready for publication on the VS Code Marketplace (V1.0)**, and for optimal use with any LLM. Section 14 additionally covers the Jarvis CLI front-end.
