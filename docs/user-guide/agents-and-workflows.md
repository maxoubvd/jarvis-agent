# Agents & Workflows

← [Back to the User Guide](README.md)

Jarvis can go beyond single answers. This page covers the four ways to run **structured, multi-step** work:

- **[Specialized agents](#specialized-agents)** — focused personas with restricted tools.
- **[Workflows](#workflows)** — predefined step sequences.
- **[Auto-TDD](#auto-tdd-tdd)** — a write → test → fix loop.
- **[The task checklist](#the-task-checklist-todo)** — the live progress list above the input.

---

## Specialized agents

A specialized agent is Jarvis running with a **focused system prompt** and a **genuinely restricted set of tools**. This keeps each agent on-task and makes read-only agents safe to run unattended. Invoke one by **mentioning it anywhere in your message** (case-insensitive), or use `/agent <task>` for an unrestricted run.

### The five built-in agents

| Agent | Specialty | Can it edit? | Can it run commands? |
|---|---|---|---|
| **`@QA-Agent`** | Rigorous code review: reads code, runs tests + linter, finds bugs, edge cases and coverage gaps, cites exact lines, rates severity (Critical/High/Medium/Low). | ❌ No | ✅ Yes |
| **`@Doc-Agent`** | Writes and improves documentation: READMEs, docstrings/JSDoc, usage guides; explains the *why*. Can search the web. | ✅ Yes | ❌ No |
| **`@Refactor-Agent`** | Improves existing code **without changing behavior** (readability, duplication, complexity, naming), in small verifiable steps, running tests after each change. | ✅ Yes | ✅ Yes |
| **`@Security-Agent`** | Read-only audit: injections, hardcoded secrets, vulnerable deps, input validation, permissions; cites exact lines and recommends fixes. | ❌ No | ❌ No |
| **`@Perf-Agent`** | Finds performance bottlenecks (algorithmic complexity, allocations, blocking I/O, N+1), measures before/after, and reports optimizations. | ❌ No | ✅ Yes |

All five can always **read** files and **read** git history. The tool restrictions apply only to Jarvis's built-in tools — any **MCP or custom tools** you've added remain available to every agent.

**Example — a read-only security audit:**
```
@Security-Agent review the authentication flow in src/backend/services for vulnerabilities
```

**Example — refactor with test verification:**
```
@Refactor-Agent simplify the nested conditionals in parser.ts and keep the tests green
```

### Auto-suggestion

In normal chat, if your message matches an agent's keywords (e.g. *bug*, *test*, *review* → QA; *security*, *audit*, *secret* → Security; *refactor*, *cleanup* → Refactor; *document*, *readme* → Doc; *performance*, *slow*, *optimize* → Perf), Jarvis prepends a tip like:

> 💡 *Tip: @Security-Agent (Security) could help — mention it to activate it.*

It's only a suggestion — nothing runs until you mention the agent yourself.

### Customizing agents

Open **Settings → Agents** to edit any agent's system prompt and its allowed tool list (comma-separated prefixes; leave empty to grant the full tool registry). You can also add your own agents there — they show up in the `@` autocomplete menu automatically.

---

## Workflows

A workflow runs a **fixed sequence of steps**, feeding each step's summary into the next. Jarvis pre-fills the [task checklist](#the-task-checklist-todo) with the step names and updates their status live. A checkpoint is created before the run so you can roll back.

**Syntax:** `/workflow <id> <task>`

| Id | Name | Steps |
|---|---|---|
| `dynamic` | Auto (Micro-Tasks) — *recommended* | No fixed steps: a Task Decomposer splits your task into micro-steps at runtime. |
| `dev-feature` | Dev Feature | Plan → Code → Test → Commit |
| `bug-fix` | Bug Fix | Analyze (root cause) → Reproduce (failing test) → Fix → Test (no regression) |
| `code-review` | Code Review | Read code → Run tests → Analyze (quality/bugs/edge cases) → Suggest (ranked report) |
| `refactor` | Refactor | Analyze → Plan (safe steps) → Apply → Test (behavior unchanged) |
| `setup-project` | Setup Project | Init (package.json, git) → Configure (tsconfig/lint) → Dependencies → Structure |

**Example:**
```
/workflow dev-feature add a /health endpoint that returns uptime and version
```

**Example (let Jarvis decompose it):**
```
/workflow dynamic migrate the settings panel from context props to a shared store
```

> Workflows run **sequentially** — there is no parallel sub-agent delegation. For a single unrestricted agentic run instead of a fixed sequence, use [`/agent`](chat-commands.md#agent-task).

---

## Auto-TDD (`/tdd`)

**Syntax:** `/tdd <task>`

Auto-TDD drives a test-first loop for you:

1. Jarvis writes the test(s) **and** implementation (each file write is HITL-approved).
2. It runs your test command.
3. On failure, it reads the (truncated) test output and retries.
4. It stops on success, or after the maximum number of attempts.

It creates a checkpoint first and auto-opens the first generated file. The run ends with either:

- `✅ Auto-TDD successful in N attempt(s)` + the list of modified files, or
- `❌ Auto-TDD failed after N attempt(s)` + the last test output.

**Relevant settings:**

| Setting | Default | Meaning |
|---|---|---|
| `jarvis.tdd.maxAttempts` | `5` | Maximum retry attempts |
| `jarvis.tdd.testCommand` | `npm test` | Command used to run the tests |
| `jarvis.terminal.timeout` | `30000` | Base timeout (ms); **doubles** after each timeout |

**Example:**
```
/tdd add a slugify(text) helper that lowercases and hyphenates, with tests
```

---

## The task checklist (TODO)

A live **checklist appears above the chat input** to show multi-step progress. It's driven by the agent's `update_todo_list` tool — each update replaces the whole list with items marked *pending*, *in progress*, or *completed*. Updates never require approval, so they don't interrupt you. Workflows pre-populate it with their step names and tick them off as they go. The checklist is cleared when you start a new session with `/new`.

---

## Related pages

- **[Chat Commands & Mentions](chat-commands.md)** — full syntax for `/agent`, `/tdd`, `/workflow`.
- **[Chat Modes & Settings](chat-modes-and-settings.md)** — HITL approvals, checkpoints, and the Settings tab.
