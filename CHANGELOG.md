# Changelog

Toutes les évolutions notables de Jarvis Agent sont documentées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), le versionnement suit [SemVer](https://semver.org/).

## [Unreleased]

Première version candidate à la publication (V1.0). N'a pas encore de tag/release publié — voir `docs/spec.md` (§9, roadmap) et `docs/audit-2026-07-11.md` (audit de code complet) pour l'historique détaillé des chantiers.

### Added
- Chat agentique multi-provider (Ollama, LM Studio, OpenRouter, Mistral, OpenAI, Anthropic, Gemini, SambaNova, HuggingFace) avec streaming et cache de réponses.
- Boucle agentique à base d'outils (fichiers, terminal, git, recherche web, process en arrière-plan) avec HITL 3 modes (strict/modéré/libre) et sandboxing (`.jarvisignore`, confinement workspace, détection de symlinks).
- Édition inline `Cmd+K`/`Ctrl+K` avec CodeLens Accept/Reject par hunk.
- Auto-TDD Loop (`/tdd`), workflows prédéfinis + workflow `dynamic` auto-décomposé (`/workflow`), 5 agents spécialisés avec restriction d'outils réelle par persona (`@QA-Agent`, `@Doc-Agent`, `@Refactor-Agent`, `@Security-Agent`, `@Perf-Agent`).
- RAG local par embeddings (`@xenova/transformers`, index en mémoire) + Context Pruning AST via Tree-sitter.
- `JARVIS.md` (instructions projet versionnées, façon `CLAUDE.md`) généré par `/init`, règles utilisateur avec scope par dossier.
- Checklist TODO persistante au-dessus du chat (`update_todo_list`), pré-remplie automatiquement pour les workflows.
- Ouverture automatique du fichier édité par l'agent (réglable : `always`/`never`/`strict-hitl-only`).
- Autocomplete inline (Tab / ghost text), désactivé par défaut.
- Checkpoints Git (stash/commit) avec rollback depuis la sidebar.
- Analytics (dashboard, export), token gauge bidirectionnelle avec historique et support des tokens mis en cache.
- Onboarding (écran de bienvenue au premier lancement, test de connexion provider, tour des fonctionnalités).
- Serveurs MCP externes configurables + outils personnalisés (`jarvis-tools/*.json`).

### Fixed
- Suppression de la plomberie morte identifiée par l'audit du 11/07/2026 : `setHitlMode` câblé (bascule instantanée du mode HITL sans passer par la sauvegarde complète des Settings), `onListSessions`/message `'sessions'` retirés (jamais utilisés), icônes `edit`/`cpu`/`square` ajoutées, types `ProviderType` frontend synchronisés (dont `huggingface`), dépendance `chart.js` retirée (jamais utilisée), références à `Vectra` retirées de la doc (jamais installé).
- Props `onNewChat`/`onResumeChat` et CSS `.empty-actions`/`.empty-action-btn` de `ChatPanel.svelte` supprimées : elles n'étaient jamais rendues dans le template (plomberie morte), et les vrais boutons "New chat"/"Resume past conversation" du header (`App.svelte`) suffisent — pas de doublon voulu dans l'état vide du chat.
- Erreurs ESLint réelles corrigées (`no-empty`, `prefer-const`) dans `orchestrator.ts`, `extension.ts`, `ollama.ts`, `openai-compatible.ts`.
- `engines.vscode` relevé à `^1.90.0` pour correspondre à `@types/vscode` (bloquait `vsce package`).
- Dépendance `uuid` supprimée (jamais importée dans le code) ; `marked`/`prismjs` déplacés vers `devDependencies` (utilisés uniquement par le bundle webview, jamais par l'extension host).
- Migration de l'outil de packaging `vsce` (déprécié, v1.x) vers `@vscode/vsce` — supprime 4 vulnérabilités connues (`markdown-it`, `linkify-it`, `xml2js`) héritées de l'ancien paquet.

### Known limitations
- Sous-agents / délégation parallèle non supportés (`WorkflowRunner` reste strictement séquentiel).
- Pas de suivi de coût monétaire (seul le comptage de tokens est disponible).
- Les checkpoints utilisent le dépôt Git réel (`git stash`/`git commit`), pas un dépôt "fantôme" séparé — peut ajouter du bruit à l'historique Git de l'utilisateur.
- Captures d'écran/vidéos de démonstration (`docs/media/`) pas encore fournies — voir la todo de publication.
