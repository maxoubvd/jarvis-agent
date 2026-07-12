# Functional and Technical Specification

Project: "Agentic" VS Code Extension (Codename: Jarvis / Jarvis-Agent)

## 1. Vision and Goals

**Description**: A state-of-the-art VS Code extension acting as an autonomous software engineer. It combines the speed and privacy of local models (Ollama) with the power of cloud models (OpenRouter), all orchestrated by the Model Context Protocol (MCP).

**Inspirations**: Continue.dev, Claude Code, Antigravity, Mistral Vibe, Codex.

**Main Goal**: Drastically reduce the time needed to create, refactor, and debug entire projects by offering a fluid interface, perfect context, and deep automation.

**Philosophy**:
- Total user control (transparency on every action)
- Native VS Code theming (seamless integration)
- "Local-first" security (data and processing local by default)
- Automation with feedback (learning user preferences)

**Target Audience**: Full-stack developers, software architects, DevOps teams, and anyone looking to speed up their development workflow.

## 2. User Interface (Frontend / Webview)

**Technical Stack**:
- **Framework**: Svelte 4.x (for its reactivity and lightness)
- **Bundler**: Vite 5.x (fast build and HMR)
- **Styling**: Tailwind CSS 4.x (with native VS Code theme)
- **State Management**: Svelte Stores (for the extension's global state)

### 2.1 Main Components

#### Sidebar Panel
- **Markdown Chat**:
  - Full Markdown support (via `marked.js` or `svelte-markdown`)
  - Syntax highlighting for code (via `prism.js` or `shiki`)
  - One-click code copy
  - File/line references (clickable links to open in the editor)
- **Chain of thought (<thinking>)**:
  - Conditional display (can be disabled)
  - Distinct visual style (light gray background, monospace font)
  - Streaming animations for real-time thoughts
- **Badge System**:
  - Status badges (✅ Success, ❌ Failure, ⚠️ Warning)
  - Type badges (📄 File, 🔧 Tool, 🧠 AI, ⏱️ Time)
  - Priority badges (High/Medium/Low)

#### Token Gauge
- **Real-time display** in the VS Code status bar
- **Details**:
  - Tokens used in the current session
  - Tokens remaining before the model limit
  - Breakdown by type (input/output)
  - History of the last 5 requests
- **Visual thresholds**:
  - Green: < 50% of the limit
  - Orange: 50-80% of the limit
  - Red: > 80% of the limit

## 3. AI Core and Routing (Backend)

**Technical Stack**:
- **Runtime**: Node.js 20.x (LTS)
- **Environment**: VS Code Extension Host (separate process)
- **API**: VS Code Extension API
- **Dependency management**: npm/yarn/pnpm

### 3.1. Model Configuration

**Multi-Provider Support**:
- **Abstraction via the `IModelProvider` interface** to make adding new providers easier
- **Dynamic configuration** via `jarvis-config.json`

**Supported Providers**:

| Provider | Type | Pre-configured Models | API Key Required |
|----------|------|------------------------|-----------------|
| Ollama | Local | qwen2.5-coder:7b, mistral-coder:7b, deepseek-coder:6.7b | ❌ No |
| LM Studio | Local | any locally loaded model | ❌ No |
| OpenRouter | Cloud | deepseek-coder-v3, gpt-4o, claude-3-5-sonnet | ✅ Yes |
| Mistral API | Cloud | mistral-large, codestral | ✅ Yes |
| OpenAI / Anthropic / Gemini / SambaNova / HuggingFace | Cloud | via a generic OpenAI-compatible wrapper | ✅ Yes |

**Per-model roles** (Settings > Models > Roles): `chat`, `edit`, `apply`, `autocomplete` — a model can be tagged for a specific use (e.g. a small, fast local model dedicated to autocomplete while a big cloud model remains the default chat model). Without an explicit tag, both `chat` and `autocomplete` fall back to the default model.


### 3.2. Streaming and Token Management

**Features**:
- **Real-time streaming**: progressive reception and display of responses
- **Bidirectional token counter**: counts input tokens (prompt + context) and output tokens (response)
- **Limit management**: warning when approaching the model's limit
- **Response cache**: remembers the latest responses to avoid recounting

### 3.3. Auto-TDD Loop

**Auto-TDD Loop Algorithm**:
```
1. RECEIVE TASK
   ↓
2. GENERATE CODE (with relevant context)
   ↓
3. WRITE/EDIT FILE
   ↓
4. RUN TESTS (via npm test, jest, mocha, etc.)
   ↓
5. ANALYZE RESULTS
   ├── IF ALL TESTS PASS → ✅ FINISH
   └── IF FAILURE →
       ├── Analyze stderr/test output
       ├── Identify the cause of the failure
       ├── Generate a targeted fix
       └── GO BACK TO STEP 2 (max 5 attempts)
```

**Handling Common Errors**:
- **Failing tests**: analyze the diff between expected and actual
- **Syntax errors**: use the linter (ESLint, TypeScript) for quick fixes
- **Missing dependencies**: detection and suggestion to install via npm/yarn
- **Timeout**: progressive timeout increase or suggestion to the user

## 4. Agentic Capabilities & MCP

**MCP Integration**:
- Uses the **Model Context Protocol (MCP)** to standardize interactions between the AI and tools
- **Benefits**: interoperability with other MCP tools, modularity, extensibility


### 4.1. System Tools (File System)

**Actually implemented built-in tools** (`src/backend/core/agent/tool-registry.ts`):

- `read_file`: reads the content of an existing file.
- `create_new_file`: creates a new file (overwrites it if it already exists).
- `edit_existing_file`: replaces a (1-indexed) line range of an existing file.
- `single_find_and_replace`: exact replacement of a single string (`replace_all` to replace every occurrence).
- `read_currently_open_file`: reads the file currently open in the VS Code editor.
- `grep_search`: recursive regex search across the workspace (filterable by glob).
- `ls`: lists the contents of a folder.
- `file_glob_search`: searches for files by glob pattern (recursive `**`).
- `run_terminal_command`: runs a shell command (configurable timeout, HITL depending on the mode).
- `run_in_background` / `check_background_process` / `stop_background_process`: launches and supervises a long-running process (dev server, watcher).
- `view_diff`: returns the current `git diff` as text in the chat.
- `git_status` / `git_log`: read-only.
- `search_web`: web search via **DuckDuckGo** (§4.2, free, no API key), with an optional `sites` parameter to restrict domains.
- `update_todo_list`: replaces the task checklist displayed above the chat input box (see §5.3).

Additional tools via **MCP servers** (Settings > MCP): builtins (`git`, `filesystem`, in-process `fetch`, `memory`) + any external server configured by the user, exposed to the same tool registry as the built-in tools.

**Built-in Security**:
- **`.jarvisignore` check** before every operation
- **Sandboxing validation** (access limited to the workspace)
- **Logging** of all operations

### 4.2. Environment & Auto-Correction

#### Run Scripts & Terminal

**Features**:
- **Shell command execution** with **mandatory approval** (configurable via HITL)
- **Real-time stdout/stderr capture**
- **Output streaming** in the chat
- **Configurable timeout** (default: 30 seconds)

**Supported Commands**:
- Simple commands: `ls -la`, `git status`
- npm scripts: `npm test`, `npm run build`
- Compound commands: `git add . && git commit -m "message"`

#### Web Search

**Implementation** (`src/backend/core/mcp/tools/webSearch.ts`):
- **Backend**: **DuckDuckGo**'s public HTML endpoint (`https://html.duckduckgo.com/html/`) — entirely free, no API key or account needed.
- **Configurable sources**: checkable presets (StackOverflow, MDN, GitHub, devdocs.io) + free-form domains, applied by default via `site:` operators; the tool also accepts an explicit `sites` parameter provided by the model, which always takes priority over the default setting.
- No dedicated cache for now (every model call triggers a request).

## 5. Advanced Customization (Agents & Workflows)

**Philosophy**: Allow users to **create their own specialized agents**, **define custom workflows**, and **apply business rules** to ensure code consistency.

### 5.1. Modular Creation

#### Tools & Skills

**Custom Tools System**:
- **JSON-based definition**: create new tools without coding
- **MCP integration**: custom tools are exposed as MCP tools
- **Local scripts**: ability to run Node.js/Shell scripts

#### Specialized Agents

**Predefined Agents** — each has a dedicated system prompt **and** a genuinely restricted subset of tools (`SpecializedAgent.allowedToolPrefixes`, applied via `ToolRegistry.restrictTo` — MCP/custom tools configured by the user always remain available, only built-in tools are filtered):

| Agent | Description | Allowed Tools | Use Case |
|-------|-------------|----------------|-------------|
| @QA-Agent | QA Agent | read, terminal, git (read) — **no editing** | Code review, running tests, bug detection |
| @Doc-Agent | Documentation Agent | read, edit, `search_web` — no terminal | Doc generation, comments, README |
| @Refactor-Agent | Refactoring Agent | read, edit, terminal, git (read) | Improving existing code, revalidation via tests |
| @Security-Agent | Security Agent | read, git (read) — **read-only, no terminal or editing** | Read-only audit, vulnerability detection |
| @Perf-Agent | Performance Agent | read, terminal, git (read) — no editing | Profiling/benchmarking, optimization reports |

**Agent Invocation System**:
- **Mentions**: use `@agent-name` in the chat to activate a specific agent
- **Auto-detection**: the extension can suggest an agent based on context
- **Customization**: the 5 predefined agents can be replaced/extended in Settings > Agents, including their list of allowed tools (free text, comma-separated — empty = full registry)

### 5.2. Rules & Context (RAG & AST)

#### Workflows

**Predefined Action Sequences**:

| Workflow | Steps | Description |
|----------|--------|-------------|
| **Dev Feature** | Plan → Code → Test → Commit | Developing a new feature |
| **Bug Fix** | Analyze → Reproduce → Fix → Test | Resolving a bug |
| **Code Review** | Read Code → Run Tests → Analyze Coverage → Suggest Improvements | Full review of a PR |
| **Refactor** | Analyze → Plan → Apply Changes → Test | Refactoring legacy code |
| **Setup Project** | Initialize → Configure → Install Dependencies → Create Structure | Creating a new project |

#### Rules

**Rule Application** (`services/rules.ts`):
- Rules defined in Settings (Rules tab), injected into the system prompt of every agent/chat.
- **Folder-scoped rules**: each rule can have a `scope` (glob, e.g. `src/backend/**`) — a scoped rule only applies if the file currently open in the editor matches the glob; a rule without a `scope` always applies. Known limitation: `/workflow` runs have no notion of an "active file", so scoped rules don't apply there.

#### Project rules file (`JARVIS.md`)

**Versioned project instructions**, CLAUDE.md-style:
- Free-form markdown file at the workspace root, read automatically (with a cache invalidated by a file watcher) and injected into the system prompt of **all** agents/workflows/chat, before the user rules.
- Unlike rules (local config, `~/.jarvis/config.json`), `JARVIS.md` is **versioned with the code** — shared among team members.
- Automatically generated by the `/init` command (or `Jarvis: Initialize Project` in the palette): initializes a git repo if needed (explicit confirmation), analyzes the project (`package.json`, structure, entry points), and writes a structured `JARVIS.md` (Project Overview, Build & Test Commands, Architecture, Conventions, Notes for Agents). If the file already exists, confirmation is requested before replacing it.

#### AST Parsing (Tree-sitter)

**Tree-sitter Integration**:
- **Real-time parsing**: syntactic analysis of the code while editing
- **Smart context extraction**: sending only the relevant parts of the code to the AI
- **Code navigation**: quick jump between definitions and usages

**Supported Languages**:
- JavaScript, TypeScript, Python, Java, Go, Rust, C++, C#, PHP, Ruby

#### Local Vector Store (RAG)

**RAG Implementation**:
- **Automatic indexing**: project files are indexed in the background
- **Semantic search**: find similar code snippets
- **Context augmentation**: relevant results added to the prompt

### 5.3. Visual Task Tracking and Auto-Open

#### TODO Checklist (Claude Code `TodoWrite`-style)

- `update_todo_list` tool: the model replaces the entire task list (`{id, content, status: pending|in_progress|completed}`) on every call. No side effects — never any HITL friction, even in strict mode.
- Displayed as a persistent component above the chat input box (not tied to a specific message, unlike the per-turn activity log); cleared on `/new`, otherwise kept after the task ends so it stays viewable.
- For `/workflow` (steps known in advance): the checklist is **automatically pre-filled** from the workflow's steps even before the first step begins, and updated (`pending` → `in_progress` → `completed`) at each transition — visibility for free without waiting for the model to call the tool.

#### Auto-opening the edited file

- After every successful edit (`create_new_file`/`edit_existing_file`/`single_find_and_replace`), the file is brought to the foreground in the editor ("preview" tab, reused for each subsequent edit — no tab stacking), so the inline decorations (green/red) are immediately visible.
- `jarvis.autoOpen.mode` setting (Settings > Optimization or VS Code settings): `always` (default), `never`, or `strict-hitl-only` (only opens in strict HITL mode, where the user is already interrupted on every action).
- The detailed per-hunk diff review (accept/reject) remains handled by the existing review panel (`DiffReviewPanel`, accept/reject CodeLens) — auto-open only brings the file to the screen, it doesn't replace this mechanism.

#### Inline autocomplete (Tab / ghost text)

- `vscode.languages.registerInlineCompletionItemProvider`, a single non-agentic call per completion (no tool loop), with debounce (~350ms) and cancellation via `CancellationToken` on every new keystroke.
- Deliberately reduced context (≈60 lines before / 20 after the cursor, no full RAG) to stay compatible with the expected latency of a completion triggered on every typing pause.
- Model used: the first model tagged with the `autocomplete` role (Settings > Models > Roles), otherwise automatic fallback to the default chat model — no dedicated model configuration is required.
- **Disabled by default** (`jarvis.autocomplete.enabled` setting): a feature that calls a model on every typing pause, must be explicitly enabled.

## 6. Security, Reliability & Privacy (Sandboxing)

**Security Principles**:
- **Least privilege by default**: the extension only has access to the open workspace
- **Total transparency**: all actions are logged and visible
- **User control**: the user always has the final word
- **Local-first**: sensitive data never leaves the machine (unless explicitly configured)

### 6.1. System Protection

#### `.jarvisignore` (Exclusion File)

**How it works**:
- **Auto-generation**: created automatically on first activation
- **Format**: identical to `.gitignore` (Git pattern syntax)
- **Priority**: stricter than `.gitignore` (a file ignored by `.jarvisignore` cannot be accessed, even if tracked by Git)

**Default content**:
```ignore
# Jarvis Ignore File - Files strictly invisible to the AI
# Auto-generated - can be edited manually

# Environment and secrets
.env
.env.*
*.env
!.env.example

# Dependencies
node_modules/
vendor/
bower_components/

# Build artifacts
dist/
build/
out/
*.min.js
*.min.css

# Cache and temp files
.cache/
.tmp/
*.tmp
*.swp
.DS_Store

# IDE and editor
.idea/
.vscode/
*.sublime-workspace
*.sublime-project

# OS
*.log
*.bak
*.backup

# Security
*.pem
*.key
*.crt
*.pfx
secrets/
credentials/

# Databases
*.db
*.sqlite
*.sqlite3

# Jarvis internal
.jarvis/
.jarvisignore
jarvis-*.json
```

**Managing `.jarvisignore`**:
- **Manual editing**: the user can modify the file at any time
- **Automatic validation**: syntax check after modification
- **Sync**: changes are picked up immediately

**VS Code Commands**:
- `Jarvis: Generate .jarvisignore` - regenerates the file with the recommended patterns
- `Jarvis: Add to .jarvisignore` - adds the selected file to `.jarvisignore`
- `Jarvis: Remove from .jarvisignore` - removes a pattern from `.jarvisignore`

#### Sandboxing (Workspace Isolation)

**Security Mechanisms**:

| Mechanism | Description | Implementation |
|-----------|-------------|----------------|
| **Workspace Root** | Restricted to the VS Code workspace root | `vscode.workspace.workspaceFolders[0].uri.fsPath` |
| **Path Validation** | Verifies all paths are inside the workspace | `path.startsWith(workspaceRoot)` |
| **Symlink Protection** | Detects and blocks outbound symlinks | `fs.lstat().isSymbolicLink()` |
| **Parent Directory Check** | Prevents `../` from escaping the workspace | `path.normalize().startsWith(workspaceRoot)` |

**Multi-Folder Workspace Management**:
- **Full support**: each folder in the workspace has its own `.jarvisignore`
- **Isolation**: an agent cannot access files in another workspace folder without explicit permission
- **Per-folder configuration**: rules can differ for each folder

#### Scrubbing (Secret Filtering)

**Types of Secrets Detected**:

| Type | Pattern | Example |
|------|---------|---------|
| API keys | `[a-zA-Z0-9]{32,}` | `sk-abcdef1234567890abcdef1234567890` |
| JWT tokens | `eyJ[A-Za-z0-9-_=]+\[.A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| Private keys | `-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----` | `-----BEGIN RSA PRIVATE KEY-----` |
| Passwords | `(password|passwd|pwd)[=:"\s][^
]{4,}` | `password: "mysecret123"` |
| AWS secrets | `AKIA[0-9A-Z]{16}` | `AKIAIOSFODNN7EXAMPLE` |
| GitHub secrets | `ghp_[a-zA-Z0-9]{36}` | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |

**Behavior by Provider**:
- **Local (Ollama)**: no scrubbing by default (data stays local)
- **Cloud (OpenRouter, OpenAI, etc.)**: scrubbing always enabled
- **Bypass option**: the user can temporarily disable it for a specific prompt

### 6.2. "Time Travel" (Git Checkpointing)

**Concept**: automatically saves the project's state before any significant change, allowing instant rollback in case of error.

**Checkpoint Mechanisms**:

| Type | Trigger | Method | Persistence |
|------|-------------|---------|-------------|
| **Single Action** | Before a dangerous action | `git stash` | Session |
| **Action Plan** | Before a full workflow | `git commit` | Permanent |
| **Session** | Session start | `git stash` | Session |
| **Manual** | User command | `git commit` | Permanent |

**Checkpoint Naming**:
- **Format**: `jarvis/checkpoint-[timestamp]-[type]-[description]`
- **Examples**:
  - `jarvis/checkpoint-20260703-123456-action-rm-node_modules`
  - `jarvis/checkpoint-20260703-123500-workflow-dev-feature-user-auth`
  - `jarvis/checkpoint-20260703-123600-session-start`

**UI Integration**:
- **"Rollback" button** in the sidebar with:
  - List of available checkpoints
  - Change preview (diff)
  - Confirmation before rollback
- **Notifications**: warning when a checkpoint is created
- **VS Code Command**: `Jarvis: List Checkpoints` and `Jarvis: Rollback to Checkpoint`

d.json"        |
|                                          |
| 🔴 12:00:00 - session-start               |
|     → Stash: jarvis/checkpoint-120000    |
|     "Session start"                      |
|                                          |
+------------------------------------------+
| [✅ Apply Rollback] [❌ Cancel]        |
+------------------------------------------+
```

**Time Travel Configuration**:
```json
{
  "checkpoints": {
    "enabled": true,
    "autoCreate": {
      "onDangerousAction": true,
      "onWorkflowStart": true,
      "onSessionStart": true
    },
    "retention": {
      "actionCheckpoints": 24,    // 24 hours
      "workflowCheckpoints": 7,   // 7 days
      "sessionCheckpoints": 1,    // 1 session
      "manualCheckpoints": 30     // 30 days
    },
    "storage": {
      "useGitStash": true,\n      "useGitTags": true
    }
  }
}
```

**Conflict Management**:
- **Automatic detection**: if uncommitted changes exist before a rollback
- **Options**:
  - **Stash**: save current changes before rollback
  - **Discard**: ignore current changes
  - **Cancel**: cancel the rollback
- **Notification**: the user is always warned before any data loss

## 7. Optimization Strategies for Small Models (Local / Ollama)

**Problem**: small models (e.g. qwen2.5-coder:7b, mistral-coder:7b) have **limitations**:
- **Limited context**: 32K tokens max (vs. 200K+ for large models)
- **Reduced reasoning ability**: worse at complex tasks
- **Lower accuracy**: more risk of errors or hallucinations
- **No external knowledge**: no access to the internet or recent data

**Goal**: **Maximize the efficiency** of small models by:
1. **Reducing the complexity** of tasks (Micro-Tasks)
2. **Improving the structure** of requests (JSON Mode, Few-Shot)
3. **Optimizing context** (Context Pruning)
4. **Systematically validating** results

### 7.1. Micro-Tasks (Task Decomposition)

**Principle**: break down complex requests into **atomic sub-tasks** that the model can handle individually.

**Decomposition Example**:
```
User request:
"Create a complete web application with a React frontend, Node.js backend,
MongoDB database, and deployment on AWS"

Breakdown into Micro-Tasks:
1. Analyze the requirements and create an architecture plan
2. Initialize the project (folder structure, package.json)
3. Create the TypeScript configuration
4. Build the React frontend (components, hooks)
5. Build the Node.js backend (routes, controllers)
6. Configure MongoDB (schemas, connections)
7. Write the unit tests
8. Configure AWS deployment
9. Document the project
```

**Decomposition Strategy**:

| Task Type | Decomposition Level | Example |
|---------------|---------------------|---------|
| **Function creation** | 1 task | "Write a sort function in JS" |
| **Component creation** | 1 task | "Create a Button component with props" |
| **Page creation** | 2-3 tasks | 1. HTML structure, 2. CSS styling, 3. JS logic |
| **Module creation** | 3-5 tasks | 1. Types/Interfaces, 2. Functions, 3. Tests |
| **Application creation** | 10+ tasks | See example above |


**Benefits of Micro-Tasks**:
- **Better quality**: the model focuses on one thing at a time
- **Fewer errors**: reduced cognitive complexity
- **Better context**: each task can have its own targeted context
- **Intermediate validation**: possibility of validating each step
- **Easy resumption**: if a task fails, you can restart from there

### 8.2. JSON Mode & Few-Shot Prompting

**JSON Mode**: force the model to respond in a **structured, parseable format**.

**Benefits**:
- **Guaranteed parsing**: no ambiguity in the response
- **Easy validation**: the structure can be validated before processing
- **Simplified integration**: responses can be used directly in the code


**Few-Shot Prompting**: provide **concrete examples** before the actual request to guide the model.


**JSON Response Validation (Version 2.1 - With Robust Cleaner)**:

**⚠️ Identified problem**: local models (Qwen 2.5 7B) don't always perfectly follow the JSON format.

**✅ Solution**: built-in multi-step cleaner

### 8.3. Context Pruning (AST-based)

**Problem**: sending **entire files** to the AI consumes a lot of tokens and can overwhelm small models.

**Solution**: send only the **relevant parts** of the code, extracted via AST (Abstract Syntax Tree) analysis.

**Context Pruning Levels**:

| Level | Description | Tokens Saved | Use |
|--------|-------------|------------------|-------------|
| **None** | Full file | 0% | Complex debugging |
| **Function** | Current function + imports | 70-80% | Function modification |
| **Class** | Full class + dependencies | 50-60% | Class modification |
| **Module** | Full module | 30-40% | Adding a feature |
| **Project** | Entire project (filtered) | 10-20% | Global refactoring |


## 9. Roadmap

**Approach**: **Incremental and iterative** development with functional deliverables at each phase.
**Prioritization**: start with the **MVP (Minimum Viable Product)** then add advanced features.
**Estimate**: each phase should take **2-4 weeks** depending on availability.

### 9.1. Phase 1: Setup & Foundations (MVP Core)

**Goal**: create a **basic functional** VS Code extension with a user interface and model management.

**Deliverables**:
- [ ] VS Code Extension boilerplate with TypeScript
- [ ] Base configuration (Svelte + Vite + Tailwind)
- [ ] Backend architecture (Node.js + MCP)
- [ ] User interface (Sidebar, Chat Panel)
- [ ] **Token Gauge** (real-time indicator)
- [ ] **`.jarvisignore`** (generation and management)
- [ ] Model configuration (Ollama + OpenRouter)
- [ ] Basic response streaming

**Detailed Tasks**:

| # | Task | Priority | Complexity | Dependencies |
|---|-------|----------|------------|-------------|
| 1 | Initialize the VS Code Extension project | ⭐⭐⭐⭐⭐ | Medium | None |
| 2 | Configure TypeScript, ESLint, Prettier | ⭐⭐⭐⭐ | Low | 1 |
| 3 | Add Svelte + Vite for webviews | ⭐⭐⭐⭐ | Medium | 1 |
| 4 | Configure Tailwind CSS with VS Code theme | ⭐⭐⭐ | Low | 3 |
| 5 | Create the backend structure (core/, services/) | ⭐⭐⭐⭐ | Medium | 1 |
| 6 | Implement the basic MCP client | ⭐⭐⭐⭐ | High | 5 |
| 7 | Add basic MCP tools (read_file, write_file) | ⭐⭐⭐⭐ | Medium | 6 |
| 8 | Create the Chat Panel (Markdown display) | ⭐⭐⭐⭐ | Medium | 4 |
| 9 | Implement the Token Counter | ⭐⭐⭐⭐ | Medium | 6 |
| 10 | Add the token indicator to the status bar | ⭐⭐⭐ | Low | 9 |
| 11 | Generate and manage .jarvisignore | ⭐⭐⭐ | Medium | 5 |
| 12 | Configure the model providers | ⭐⭐⭐⭐ | Medium | 5 |
| 13 | Implement response streaming | ⭐⭐⭐ | Medium | 6 |
| 14 | Add model selection in the UI | ⭐⭐⭐ | Low | 12 |
| 15 | Basic unit tests | ⭐⭐⭐ | Medium | 1-14 |

**Validation Criteria**:
- [ ] The extension installs and activates in VS Code
- [ ] The chat displays responses in Markdown
- [ ] The Token Gauge works and updates in real time
- [ ] `.jarvisignore` effectively blocks access to the listed files
- [ ] Ollama and OpenRouter models respond correctly
- [ ] Streaming displays responses word by word

---

### 9.2. Phase 2: Actions & Security

**Goal**: add **action capabilities** (terminal, file modification) with a **robust security system**.

**Deliverables**:
- [ ] **Integrated terminal** with command execution
- [ ] **File read/write** with validation
- [ ] **HITL (Human-in-the-Loop)** with 3 modes
- [ ] **Time Travel** (Git Checkpoints)
- [ ] Secret **Scrubbing**
- [ ] Full **Sandboxing**
- [ ] Notification and confirmation system

**Detailed Tasks**:

| # | Task | Priority | Complexity | Dependencies |
|---|-------|----------|------------|-------------|
| 1 | Implement the MCP terminal tool | ⭐⭐⭐⭐⭐ | High | Phase 1 |
| 2 | Add stdout/stderr capture | ⭐⭐⭐⭐ | High | 1 |
| 3 | Implement edit_file (not just write_file) | ⭐⭐⭐⭐ | High | Phase 1 |
| 4 | Create the HITL Manager system | ⭐⭐⭐⭐⭐ | High | Phase 1 |
| 5 | Add the 3 HITL modes (strict, moderate, free) | ⭐⭐⭐⭐ | Medium | 4 |
| 6 | Implement HITL configuration | ⭐⭐⭐ | Medium | 4 |
| 7 | Create the SandboxManager | ⭐⭐⭐⭐⭐ | High | Phase 1 |
| 8 | Implement path validation | ⭐⭐⭐⭐ | High | 7 |
| 9 | Add symlink detection | ⭐⭐⭐ | Medium | 7 |
| 10 | Implement the SecretScrubber | ⭐⭐⭐⭐ | High | Phase 1 |
| 11 | Add default patterns | ⭐⭐⭐ | Medium | 10 |
| 12 | Configure scrubbing per provider | ⭐⭐⭐ | Medium | 10 |
| 13 | Create the CheckpointManager | ⭐⭐⭐⭐ | High | Phase 1 |
| 14 | Implement checkpoint creation | ⭐⭐⭐⭐ | High | 13 |
| 15 | Add rollback via git stash/tag | ⭐⭐⭐⭐ | High | 13 |
| 16 | Create the Rollback button UI | ⭐⭐⭐ | Medium | 13 |
| 17 | Add security notifications | ⭐⭐⭐ | Low | 4,7,10 |
| 18 | Security tests (sandboxing, scrubbing) | ⭐⭐⭐⭐ | High | 1-17 |

**Validation Criteria**:
- [ ] Terminal commands run with HITL confirmation
- [ ] Files cannot be read/written outside the workspace
- [ ] `.jarvisignore` effectively blocks access
- [ ] Secrets are filtered before being sent to the cloud
- [ ] Git checkpoints are created automatically
- [ ] Rollback works and restores the exact state
- [ ] The 3 HITL modes work as expected

---

### 9.3. Phase 3: Agentic & TDD

**Goal**: add advanced **agentic capabilities** and the **Auto-TDD loop**.

**Deliverables**:
- [ ] **JSON configuration for Tools**
- [ ] Full **Auto-TDD loop**
- [ ] Smart **error handling**
- [ ] Simple **workflow system**
- [ ] Basic **specialized agents** (@QA-Agent, @Doc-Agent)
- [ ] Integration with tests (Jest, Mocha, etc.)

**Detailed Tasks**:

| # | Task | Priority | Complexity | Dependencies |
|---|-------|----------|------------|-------------|
| 1 | Implement the custom Tools system | ⭐⭐⭐⭐ | High | Phase 2 |
| 2 | Add loading tools from jarvis-tools/ | ⭐⭐⭐ | Medium | 1 |
| 3 | Create the Auto-TDD Loop Manager | ⭐⭐⭐⭐⭐ | High | Phase 2 |
| 4 | Implement test execution | ⭐⭐⭐⭐ | High | Phase 2 |
| 5 | Add test error analysis | ⭐⭐⭐⭐ | High | 4 |
| 6 | Implement fix generation | ⭐⭐⭐⭐ | High | 5 |
| 7 | Configure the max number of attempts | ⭐⭐⭐ | Medium | 3 |
| 8 | Add timeout handling | ⭐⭐⭐ | Medium | 3 |
| 9 | Create the basic specialized agents | ⭐⭐⭐ | Medium | Phase 2 |
| 10 | Implement the agent invocation system | ⭐⭐⭐⭐ | High | 9 |
| 11 | Add @agent mentions in the chat | ⭐⭐⭐ | Medium | 10 |
| 12 | Create the predefined workflows | ⭐⭐⭐ | Medium | Phase 2 |
| 13 | Implement sequential workflow execution | ⭐⭐⭐⭐ | High | 12 |
| 14 | Add dependency management between tasks | ⭐⭐⭐ | Medium | 13 |
| 15 | TDD loop tests | ⭐⭐⭐⭐ | High | 1-14 |

**Validation Criteria**:
- [ ] Custom tools can be defined and used
- [ ] The Auto-TDD loop works for simple cases
- [ ] Test errors are analyzed and fixed automatically
- [ ] Specialized agents respond correctly to their mentions
- [ ] Workflows run sequentially
- [ ] Maximum 5 attempts before giving up

---

### 9.4. Phase 4: Analytics & Context

**Goal**: add the **analytics layer** and improve **context management**.

**Deliverables**:
- [ ] Full **Analytics Dashboard**
- [ ] **Token tracking** per model and session
- [ ] **Performance metrics** (success rate, average time)
- [ ] **@file and @docs** in the chat
- [ ] **Similar code search** (basic RAG)
- [ ] Prompt **self-assessment**
- [ ] Data export

**Detailed Tasks**:

| # | Task | Priority | Complexity | Dependencies |
|---|-------|----------|------------|-------------|
| 1 | Create the stats file structure | ⭐⭐⭐ | Medium | Phase 1 |
| 2 | Implement the AnalyticsCollector | ⭐⭐⭐⭐ | High | 1 |
| 3 | Add token tracking | ⭐⭐⭐⭐ | High | 2 |
| 4 | Implement action tracking | ⭐⭐⭐⭐ | High | 2 |
| 5 | Create the Dashboard UI (Svelte) | ⭐⭐⭐⭐ | High | Phase 1 |
| 6 | Add charts (Chart.js) | ⭐⭐⭐ | Medium | 5 |
| 7 | Implement dashboard tabs | ⭐⭐⭐ | Medium | 5 |
| 8 | Add @file to read files | ⭐⭐⭐ | Medium | Phase 2 |
| 9 | Implement @docs for documentation | ⭐⭐⭐ | Medium | Phase 2 |
| 10 | Set up local RAG (in-memory index + embeddings) | ⭐⭐⭐⭐ | High | Phase 2 |
| 11 | Implement file indexing | ⭐⭐⭐ | Medium | 10 |
| 12 | Add semantic search | ⭐⭐⭐⭐ | High | 10 |
| 13 | Implement self-assessment | ⭐⭐⭐ | Medium | 2 |
| 14 | Add prompt scoring | ⭐⭐⭐ | Medium | 13 |
| 15 | Implement data export | ⭐⭐⭐ | Medium | 2 |
| 16 | Add stats reset | ⭐⭐⭐ | Low | 2 |
| 17 | Analytics feature tests | ⭐⭐⭐ | Medium | 1-16 |

**Validation Criteria**:
- [ ] The dashboard correctly displays stats
- [ ] Tokens are counted accurately
- [ ] @file and @docs work in the chat
- [ ] RAG search returns relevant results
- [ ] Export generates valid JSON/CSV files
- [ ] Self-assessment suggests improvements

---

### 9.5. Phase 5: Optimization & Advanced Features

**Goal**: **optimize** performance and add **advanced features** for power users.

**Deliverables**:
- [x] **Tree-sitter** for AST parsing
- [x] Advanced **Context Pruning**
- [x] Full **local RAG** with embeddings (`@xenova/transformers`, homegrown in-memory index)
- [x] **Inline Diff** (Cmd+K)
- [ ] **Plugin system** — not done as such; covered otherwise by external MCP + custom tools (`jarvis-tools/*.json`)
- [x] **Extensibility** (Tools, Agents, Workflows) — agents with per-persona tool restrictions, folder-scoped rules
- [x] Advanced **Web Search** integration — DuckDuckGo (free, no key), configurable sources (§4.2)
- [x] Automatic **Micro-Tasks** (`TaskDecomposer`, `dynamic` workflow)

**Detailed Tasks**:

| # | Task | Priority | Complexity | Dependencies |
|---|-------|----------|------------|-------------|
| 1 | Integrate Tree-sitter (web-tree-sitter) | ⭐⭐⭐⭐ | High | Phase 3 |
| 2 | Add grammars for supported languages | ⭐⭐⭐ | Medium | 1 |
| 3 | Implement the AST-based ContextPruner | ⭐⭐⭐⭐⭐ | Very High | 1 |
| 4 | Add automatic strategy selection | ⭐⭐⭐⭐ | High | 3 |
| 5 | Integrate pruning with the Token Counter | ⭐⭐⭐⭐ | High | 3, Phase 2 |
| 6 | Complete the local RAG | ⭐⭐⭐⭐ | High | Phase 4 |
| 7 | Add embeddings (all-minilm) | ⭐⭐⭐ | Medium | 6 |
| 8 | Implement context augmentation | ⭐⭐⭐⭐ | High | 6 |
| 9 | Create the Inline Diff View | ⭐⭐⭐ | Medium | Phase 2 |
| 10 | Implement Cmd+K for diffs | ⭐⭐⭐⭐ | High | 9 |
| 11 | Add the plugin system | ⭐⭐⭐⭐ | High | Phase 3 |
| 12 | Create the plugin API | ⭐⭐⭐⭐ | High | 11 |
| 13 | Implement dynamic loading | ⭐⭐⭐ | Medium | 11 |
| 14 | Add advanced Web Search | ⭐⭐⭐ | Medium | Phase 2 |
| 15 | Implement result caching | ⭐⭐⭐ | Medium | 14 |
| 16 | Add automatic Micro-Tasks | ⭐⭐⭐⭐ | High | Phase 3 |
| 17 | Implement complexity detection | ⭐⭐⭐⭐ | High | 16 |
| 18 | Performance optimizations | ⭐⭐⭐ | Medium | All |
| 19 | Full tests of all features | ⭐⭐⭐⭐ | High | All |

**Validation Criteria**:
- [x] Context Pruning reduces tokens by 50%+ for small models
- [x] RAG returns accurate results
- [x] Inline Diff works with Cmd+K
- [ ] Plugins can be installed and used (not applicable — no dedicated plugin system)
- [x] Micro-Tasks are generated automatically
- [x] Performance is optimal (no UI lag)

### 9.6. V1 Finalization (2026-07-11 audit)

**Goal**: close the remaining gaps with the spec identified by a full code audit (`docs/audit-2026-07-11.md`) before the v1 release, and clean up dead code accumulated over the iterations.

**Deliverables**:
- [x] **Specialized agents** with real per-persona tool restrictions (§5.1)
- [x] **Auto-opening** the file edited by the agent (§5.3)
- [x] **Functional `search_web`** via DuckDuckGo (free, no key), configurable sources (§4.2)
- [x] **`JARVIS.md`** — versioned project instructions file + `/init` command (§5.2)
- [x] **Folder-scoped rules** (`RuleItem.scope`, §5.2)
- [x] Persistent **TODO checklist** above the chat, pre-filled for workflows (§5.3)
- [x] **Inline autocomplete** (Tab / ghost text), disabled by default (§5.3)
- [x] Cleanup: dead model roles removed from the UI, instant `setHitlMode`, dead code removed (`onListSessions`), missing icons added, `ProviderType`/`ChatPanel` types synced, unused `chart.js` dependency removed (never used), `Vectra` references removed from the docs (never installed)
- [~] `ChatPanel`'s `onNewChat`/`onResumeChat` props: wrongly marked "made functional" — never actually wired up in the template. Fixed on 2026-07-11 (follow-up) by **removing** them rather than wiring them up: the real "New chat"/"Resume" buttons already live in `App.svelte`'s header, a duplicate in the chat's empty state was not desired.
- Explicitly out of scope (deferred): sub-agents/parallel delegation, monetary cost tracking, checkpoints on a "shadow" git repo

**9.6.1. Code verification pass + publication prep (2026-07-11, follow-up)** — see the addendum in `docs/audit-2026-07-11.md` and `CHANGELOG.md` for details:
- [x] Build + lint + full test suite verified (42 files, 322 tests) — 5 genuine ESLint errors fixed; `ChatPanel`'s dead `onNewChat`/`onResumeChat` props (+ orphaned `.empty-actions` CSS) removed rather than wired up, at the user's explicit request
- [x] `vsce package` blocker fixed (`engines.vscode` vs `@types/vscode`), dead/misplaced dependencies cleaned up (`uuid`, `marked`/`prismjs`), migrated `vsce` → `@vscode/vsce` (0 vulnerabilities remaining)
- [x] `.vscodeignore`, Marketplace PNG icon, `package.json` metadata (repository/bugs/homepage/keywords/icon), `CHANGELOG.md`, `SECURITY.md` added
- [ ] Screenshots/demo videos (`docs/media/`) — still to be done manually, see the publication task list


### 10 Resources and References

**Official Documentation**:
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/spec)
- [Svelte Documentation](https://svelte.dev/docs)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [Vite Documentation](https://vitejs.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

**Libraries and Tools**:
- [Ollama](https://ollama.ai/) - Local models
- [OpenRouter](https://openrouter.ai/) - Cloud model API
- [web-tree-sitter](https://github.com/Paulrberg/web-tree-sitter) - Tree-sitter for the browser
- [@xenova/transformers](https://github.com/xenova/transformers.js) - Local embeddings for RAG (homegrown in-memory vector index, no external database)
- [marked.js](https://marked.js.org/) - Markdown parsing

**Inspiring Projects**:
- [Continue.dev](https://github.com/continuedev/continue) - AI VS Code extension
- [Claude Code](https://github.com/sourcegraph/claude-code) - (formerly)
- [Antigravity](https://github.com/antigravity-ai/antigravity) - Code agent
- [Mistral Vibe](https://github.com/mistralai/vibe) - CLI Agent
- [Codex](https://github.com/features/codex) - (GitHub)

**Community**:
- [VS Code Extensions](https://code.visualstudio.com/docs/editor/extension-gallery)
- [Awesome VS Code](https://github.com/viatsko/awesome-vscode)
- [MCP Community](https://github.com/modelcontextprotocol/community)

**Development Tools**:
- [VS Code Extension Generator](https://code.visualstudio.com/api/get-started/extension-generator)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [VS Code Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Yeoman Generator for VS Code](https://github.com/microsoft/vscode-generator)
