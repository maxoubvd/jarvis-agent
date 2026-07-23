# Security Policy

Jarvis Agent is an agentic coding assistant: it can read/write files in your workspace and, depending on the HITL (Human In the Loop) mode you configure, run terminal commands. Please read this before reporting an issue or relying on it in a sensitive environment.

This policy covers **both front-ends** — the VS Code extension and the `jarvis` CLI — since they share the same engine (`@jarvis/core`), the same sandbox and HITL implementation, and the same `~/.jarvis/config.json`.

## Reporting a Vulnerability

If you find a security issue (sandbox escape, prompt injection leading to unauthorized file/terminal access, secret leakage to a cloud provider, etc.), please **do not open a public GitHub issue**. Instead, report it privately by emailing the maintainer (see the GitHub profile linked from the repository) or via [GitHub's private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability) on this repository.

Please include:
- A description of the issue and its impact.
- Steps to reproduce (HITL mode, provider, workspace layout if relevant).
- The extension version (`package.json` `version`) and VS Code version.

We'll acknowledge reports within a few days on a best-effort basis — this is a community project without a dedicated security team.

## Security Model (what's already in place)

- **Sandboxing** (`packages/core/src/core/utils/sandbox.ts`): all file tools are confined to the workspace root, with symlink and `../` traversal checks, plus `.jarvisignore` (auto-generated, stricter than `.gitignore`, blocks `.env`, keys, credentials, etc. by default). The workspace root is the VS Code workspace folder in the extension, and the directory you launched `jarvis` from in the CLI.
- **Human-in-the-Loop (HITL)** (`packages/core/src/services/hitl.ts`): terminal commands and destructive file operations require explicit approval by default (`strict`/`moderate` modes); `free` mode removes this and should only be used in trusted, disposable environments. The extension prompts with a webview card (or a native modal); the CLI prompts inline in the terminal — same rules, same modes.
- **Secret scrubbing** (`packages/core/src/core/utils/scrubber.ts`): outgoing prompts to **cloud** providers are scanned for API keys, JWTs, private keys, passwords, AWS/GitHub tokens before being sent. Local providers (Ollama, LM Studio) are not scrubbed by default since nothing leaves the machine.
- **Checkpoints** (`packages/core/src/services/checkpoint.ts`): git-stash/commit based rollback lets you undo any change the agent made.

## Known limitations (be aware of these)

- HITL and sandboxing reduce but do not eliminate risk from a **malicious or buggy model response** — a model can still ask for terminal commands that are individually "safe-looking" but harmful in combination. Review HITL prompts before approving, especially in `moderate` mode.
- **Prompt injection**: content fetched via `@docs:`, `search_web`, or read from files/RAG can contain instructions that a model may follow. Jarvis does not currently sandbox tool *results* against this — treat any workspace you didn't fully audit (or any external MCP server / doc source you add) as a trust boundary.
- Cloud provider API keys are stored in `~/.jarvis/config.json` (and an optional workspace override) in plaintext, consistent with how most VS Code AI extensions store credentials — protect access to your machine/dotfiles accordingly.
- `free` HITL mode disables approval prompts entirely; only use it in environments you fully trust.
- **The CLI has no workspace-trust gate.** The extension declares `untrustedWorkspaces: false`, so VS Code blocks agent tools in an untrusted folder. The CLI has no equivalent prompt: running `jarvis` in a directory already grants it that directory as its sandbox root. Don't run it inside a repository you haven't reviewed — especially not with `free` HITL mode, and be aware that a `JARVIS.md` or `jarvis-tools/*.json` committed by someone else is attacker-controlled input.
