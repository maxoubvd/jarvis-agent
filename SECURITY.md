# Security Policy

Jarvis Agent is an agentic coding assistant: it can read/write files in your workspace and, depending on the HITL (Human In the Loop) mode you configure, run terminal commands. Please read this before reporting an issue or relying on it in a sensitive environment.

## Reporting a Vulnerability

If you find a security issue (sandbox escape, prompt injection leading to unauthorized file/terminal access, secret leakage to a cloud provider, etc.), please **do not open a public GitHub issue**. Instead, report it privately by emailing the maintainer (see the GitHub profile linked from the repository) or via [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) on this repository.

Please include:
- A description of the issue and its impact.
- Steps to reproduce (HITL mode, provider, workspace layout if relevant).
- The extension version (`package.json` `version`) and VS Code version.

We'll acknowledge reports within a few days on a best-effort basis — this is a community project without a dedicated security team.

## Security Model (what's already in place)

- **Sandboxing** (`src/backend/core/utils/sandbox.ts`): all file tools are confined to the workspace root, with symlink and `../` traversal checks, plus `.jarvisignore` (auto-generated, stricter than `.gitignore`, blocks `.env`, keys, credentials, etc. by default).
- **Human-in-the-Loop (HITL)** (`src/backend/services/hitl.ts`): terminal commands and destructive file operations require explicit approval by default (`strict`/`moderate` modes); `free` mode removes this and should only be used in trusted, disposable environments.
- **Secret scrubbing** (`src/backend/core/utils/scrubber.ts`): outgoing prompts to **cloud** providers are scanned for API keys, JWTs, private keys, passwords, AWS/GitHub tokens before being sent. Local providers (Ollama, LM Studio) are not scrubbed by default since nothing leaves the machine.
- **Checkpoints** (`src/backend/services/checkpoint.ts`): git-stash/commit based rollback lets you undo any change the agent made.

## Known limitations (be aware of these)

- HITL and sandboxing reduce but do not eliminate risk from a **malicious or buggy model response** — a model can still ask for terminal commands that are individually "safe-looking" but harmful in combination. Review HITL prompts before approving, especially in `moderate` mode.
- **Prompt injection**: content fetched via `@docs:`, `search_web`, or read from files/RAG can contain instructions that a model may follow. Jarvis does not currently sandbox tool *results* against this — treat any workspace you didn't fully audit (or any external MCP server / doc source you add) as a trust boundary.
- Cloud provider API keys are stored in `~/.jarvis/config.json` (and an optional workspace override) in plaintext, consistent with how most VS Code AI extensions store credentials — protect access to your machine/dotfiles accordingly.
- `free` HITL mode disables approval prompts entirely; only use it in environments you fully trust.
