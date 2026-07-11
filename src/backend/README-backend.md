# Jarvis Agent - Backend

Ce README décrit l'architecture backend de l'extension Jarvis Agent (extension host, `tsc` → `dist/extension.js`). Pour une vue plus détaillée orientée développement avec Claude Code, voir `CLAUDE.md` à la racine du dépôt — ce fichier reste volontairement plus court et orienté onboarding.

## Objectif

Le backend s'exécute dans le processus « extension host » de VS Code. Il gère le routage du chat, la boucle agentique (outils, HITL, checkpoints), les providers de modèles, l'indexation RAG, et toute la communication avec la webview (frontend).

## Structure

### `src/extension.ts`

Point d'entrée de l'extension (`activate`/`deactivate`).
- Instancie `JarvisExtension` et enregistre les commandes VS Code : `jarvis.startChat`, `jarvis.rollback`, `jarvis.listCheckpoints`, `jarvis.exportAnalytics`, `jarvis.generateJarvisignore`, `jarvis.addToJarvisignore`, `jarvis.removeFromJarvisignore`, `jarvis.indexWorkspace`, `jarvis.inlineEdit` (Cmd+K), `jarvis.init` (génère `JARVIS.md`).
- Enregistre le `InlineCompletionItemProvider` de l'autocomplete inline (`core/autocomplete/`), gated par `jarvis.autocomplete.enabled` (désactivé par défaut).
- Génère `.jarvisignore` en tâche de fond au démarrage si absent.

### `src/backend/core/extension.ts`

Le cœur de l'extension : deux classes.
- `JarvisSidebarProvider` (`WebviewViewProvider`) — gère la webview, le routage des messages `chatMessage`/`updateSettings`/etc., la boucle agentique (`runAgent`, `runWorkflow`, `runTDD`, `runInit`), l'assemblage du prompt système (`getPromptExtras` = `JARVIS.md` + rules + workspace profile + verbosité).
- `JarvisExtension` — wrapper fin autour du provider, appelé depuis `src/extension.ts` (statut bar, logging, checkpoint de session, watchers).

### `src/backend/core/agent/` — boucle agentique

- `orchestrator.ts` — `AgentOrchestrator` : boucle JSON-protocol (`{"thought","action"}` / `{"thought","final"}`), HITL gating, tracking des fichiers modifiés (`ChangeTracker`), événements (`AgentEvents.onToolCall/onToolResult/onFileEdited/onTodoUpdate`).
- `tool-registry.ts` — `ToolRegistry` + `createBuiltinTools()` : tous les outils intégrés (fichiers, terminal, git, recherche web, `update_todo_list`). Chaque outil a une `origin` (`builtin`/`custom`/`mcp`) ; `restrictTo()` ne filtre jamais les outils MCP/custom.
- `todo.ts` — type `TodoItem` + validation, partagé entre l'outil et l'orchestrateur.
- `custom-tools.ts` — chargement des outils utilisateur depuis `<workspace>/jarvis-tools/*.json`.
- `autocomplete/` — `provider.ts` (`InlineCompletionItemProvider`, debounce + annulation) et `prompt.ts` (construction du prompt, pur/testable sans vscode).
- `utils/` — `sandbox.ts` (`SandboxManager`, confinement workspace + `.jarvisignore`), `scrubber.ts` (`SecretScrubber`, providers cloud uniquement), `json-cleaner.ts` (extraction JSON robuste), `glob.ts` (`globToRegex`, partagé par `grep_search`/`file_glob_search`/règles scopées).

### `src/backend/core/mcp/`

- `client.ts` / `manager.ts` — client MCP (`@modelcontextprotocol/sdk`), connexion aux serveurs configurés (Settings > MCP) et builtins.
- `builtin.ts` — serveurs MCP intégrés (git, filesystem, fetch in-process, memory).
- `tools/` — implémentations concrètes : `fileSystem.ts` (read/write/edit/list, sandboxées), `terminal.ts` (`executeTerminalCommand`), `git.ts` (status/diff/log), `webSearch.ts` (API Brave Search, clé dans Settings > Web Search).

### `src/backend/config/`

- `config-manager.ts` — types (`JarvisConfig`, `ModelItem`, `RuleItem`, `SpecializedAgent`, `Workflow`, `WebSearchConfig`, `OptimizationConfig`…) + `ConfigManager` (lecture/écriture `~/.jarvis/config.json` + override workspace, migration du schéma legacy).
- `model-config-manager.ts` — `ModelConfigManager` : instancie un provider par modèle activé, `getModelForRole(role)` (fallback sur le modèle par défaut pour `chat`/`autocomplete`), `getContextLength()`, `isCloudProvider()`.

### `src/backend/models/`

- `abstract.ts` — interface `IModelProvider` (`sendPrompt`/`sendPromptStream`).
- `providers/` — implémentations HTTP réelles : `ollama.ts` (NDJSON), `openrouter.ts`, `lmstudio.ts`, `mistral.ts`, `openai-compatible.ts` (SSE partagé) + `openai-compatible-provider.ts` (wrapper générique pour openai/anthropic/gemini/sambanova/huggingface).

### `src/backend/services/`

- `token-counter.ts`, `response-cache.ts`, `hitl.ts`, `checkpoint.ts`, `analytics.ts`, `logger.ts` — infrastructure transverse (jauge de tokens, cache, Human-in-the-Loop, checkpoints git-stash, stats, logs).
- `agents.ts` — 5 `SpecializedAgent` prédéfinis avec `allowedToolPrefixes` par persona.
- `workflows.ts` — `WorkflowRunner` + `TaskDecomposer` (workflow `dynamic`).
- `rules.ts` — rules utilisateur, avec scope optionnel par dossier (glob).
- `jarvis-md.ts` — lecture pure de `JARVIS.md` (le cache/watcher restent dans `core/extension.ts`).
- `prompts.ts` — bibliothèque de prompts `/nom`.
- `tdd-loop.ts` — `AutoTDDLoop` (boucle Auto-TDD, DI-friendly).
- `background-processes.ts` — gestion des process longs (`run_in_background`).
- `context/` — `rag.ts` (index en mémoire, embeddings `@xenova/transformers`), `indexer.ts` (`WorkspaceIndexer`), `pruner.ts` (élagage AST via Tree-sitter), `mentions.ts` (`@file:`/`@docs:`).

## Comment démarrer

1. Installer les dépendances : `npm install`
2. Compiler le backend : `npm run build:extension`
3. Lancer l'extension dans VS Code via `F5` (Extension Development Host).
4. Tests backend : `npx vitest run test/backend/` — voir `CLAUDE.md` pour les conventions (mock `vscode`, modules DI-friendly).

## Notes techniques

- TypeScript, `Node16` (ESM) — les imports relatifs nécessitent le suffixe `.js`.
- Les chemins sont résolus depuis le premier dossier workspace (`vscode.workspace.workspaceFolders?.[0]`).
- Dépendances principales : `@modelcontextprotocol/sdk` (MCP), `@xenova/transformers` (embeddings RAG), `web-tree-sitter` (AST), `ignore` (`.jarvisignore`).
