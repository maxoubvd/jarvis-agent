# Jarvis CLI

**Jarvis Agent in your terminal.** The same autonomous software engineer as the
[VS Code extension](../../README.md), driven from the command line.

> **Not yet published to npm.** Install from source:

```bash
npm install                              # from the repository root
npm run build:cli
npm link --workspace jarvis-agent-cli    # registers the `jarvis` command globally

cd your/project
jarvis
```

(Once published: `npm install -g jarvis-agent-cli`.)

## What it is

This package is a **front-end** — all the intelligence lives in the shared
[`@jarvis/core`](../core/README.md) engine (agentic orchestrator, model providers, tools, sandbox,
checkpoints, RAG, specialized agents, workflows, Auto-TDD). The CLI supplies the terminal-flavored
host pieces: an inquirer approval prompt for HITL, `process.cwd()` as the workspace, ANSI rendering
in the extension's brand colors, and a REPL controller.

Because the engine and the config are shared, **the CLI and the extension read and write the same
`~/.jarvis/config.json`** — configure a model in one and it works in the other.

## Commands

| Command | Does |
|---|---|
| `jarvis` | Home page + interactive REPL |
| `jarvis "<prompt>"` / `jarvis -p "<prompt>"` | One-shot run, then exit |
| `jarvis settings` | Interactive settings navigator |
| `jarvis config` | Open `~/.jarvis/config.json` in `$EDITOR` |
| `jarvis checkpoints` / `jarvis rollback` | List / undo Git checkpoints |
| `jarvis init` | Analyze the project, write `JARVIS.md` |
| `jarvis analytics` | Export usage analytics |
| `jarvis --help` / `--version` | Usage / version |

In the REPL: `/agent`, `/tdd`, `/workflow`, `/init`, `/mode`, `/model`, `/settings`, `/checkpoints`,
`/rollback`, `/new`, `/help`, `/exit`, plus `@file:`, `@docs:` and `@QA-Agent`-style mentions.

Full walkthrough: **[docs/cli-guide.md](../../docs/cli-guide.md)**.

## Source layout

| File | Role |
|---|---|
| `src/cli.ts` | Entry point — argument dispatch, one-shot runs, home page |
| `src/repl.ts` | Interactive controller: slash commands, mentions, streaming agent events |
| `src/host.ts` | Session context: config, models, tool registry, HITL, checkpoints, system prompt |
| `src/settings-nav.ts` | `jarvis settings` — inquirer navigator over the config |
| `src/home.ts` | The landing page (wordmark, status, command hints) |
| `src/theme.ts` | Design language — the extension's `#c1272d` red + `#e8b84b` gold in true-color ANSI |

## Development

From the repository root:

```bash
npm install            # npm workspaces links @jarvis/core
npm run build:cli      # esbuild → packages/cli/dist/cli.js
node packages/cli/dist/cli.js --help
npx vitest run --project cli
```

The build deliberately does **not** mark `vscode` as external: if anything in the imported graph
pulled `vscode` in, the CLI build would fail. That is our standing guarantee that the shared core
stays host-agnostic.

### Dependencies, and why there are so few

esbuild **inlines** `@jarvis/core`, `@inquirer/prompts`, `marked`, `marked-terminal` and `picocolors`
into `dist/cli.js`, so they are build-time only (`devDependencies`). The only real runtime
`dependencies` are the two that stay external because they ship native/wasm assets that cannot be
bundled: `@xenova/transformers` and `web-tree-sitter`.

`@jarvis/core` is deliberately **not** declared at all: it is resolved by an esbuild alias to a file
path (and tsconfig `paths`), never through `node_modules`. Declaring a private, unpublished package
would produce a broken reference in the published manifest.

The version reported by `jarvis --version` is injected at build time from this `package.json`
(esbuild `define`), so it can never drift from what is published.

## Publishing

The package is **not on npm yet**. When you are ready:

```bash
npm run build:cli                    # from the repo root
cd packages/cli
npm pack --dry-run                   # inspect exactly what will ship
npm login
npm publish --access public
```

`prepublishOnly` re-runs the typecheck and the build, so `npm publish` can never ship a stale bundle.
Only 4 files are published (`dist/cli.js`, `README.md`, `LICENSE`, `package.json`) — roughly 950 kB
compressed; the sourcemap and all sources are excluded via the `files` allowlist.

Keep this package's `version` in sync with the extension's (root `package.json`) when releasing both.
