# Jarvis Agent - Frontend

Ce README décrit l'architecture frontend de l'extension Jarvis Agent : la webview affichée dans la sidebar VS Code (Svelte 5, runes mode, buildée par Vite → `dist/webview/assets/`).

## Objectif

Le frontend affiche le chat agentique, les paramètres, les checkpoints et les analytics. Il communique avec le backend (extension host) uniquement via `postMessage`/`window.addEventListener('message', ...)` — pas d'accès direct au système de fichiers ni à l'API VS Code (isolé par le sandbox de la webview).

## Structure

### `src/frontend/index.html` / `main.ts`

Point d'entrée : monte `App.svelte` sur `#app`.

### `src/frontend/App.svelte`

Composant racine — orchestre tout l'état de l'application (`$state`) et le switch des messages reçus du backend (`onWindowMessage`). Compose :
- `Sidebar` — navigation par onglets (chat/checkpoints/analytics/settings).
- `ChatPanel` — panneau de discussion principal.
- `TokenGauge` — jauge de tokens (statut bar + panneau détaillé, historique des 5 dernières requêtes).
- `CheckpointPanel` — liste des checkpoints git-stash + rollback.
- `AnalyticsPanel` — statistiques (barres CSS pures, pas de librairie de graphiques).
- `SettingsPanel` — tous les réglages (voir `components/settings/`).
- `DiffReviewPanel` — revue des fichiers modifiés par l'agent (accept/reject par hunk).
- `WelcomeScreen` — onboarding au premier lancement (aucun modèle configuré).

### `src/frontend/components/`

- `ChatPanel.svelte` — rendu markdown (`marked`), coloration syntaxique (`prismjs`), blocs `<thinking>` repliables, `TodoList` (checklist persistante au-dessus de la zone de saisie), autocomplétion des commandes `/` et mentions `@`, sélecteur de mode (Automatic/Fast/Plan) et de modèle.
- `TodoList.svelte` — checklist de tâches (`update_todo_list` / synthèse de workflow), repliable, statuts pending/in_progress/completed.
- `ApprovalCard.svelte` — carte d'approbation HITL affichée dans le chat (allow / allow-session / deny + feedback).
- `Icon.svelte` — icônes SVG trait 16×16 dessinées à la main (pas de dépendance d'icônes externe) ; `PATHS` est la table nom → chemin SVG.
- `Toggle.svelte` — interrupteur « lightswitch » réutilisé dans tous les settings.
- `SettingsPanel.svelte` — orchestre les sections ci-dessous, gère la sérialisation vers `JarvisConfig` et l'état "dirty"/save.

### `src/frontend/components/settings/`

Une section par domaine de configuration, toutes suivant le même pattern (`items`/`config` + `onChange` callback) :
- `ModelsSection.svelte` — providers/modèles, clés API, rôles (`chat`/`edit`/`apply`/`autocomplete`).
- `AgentsSection.svelte` — agents spécialisés (system prompt + outils autorisés).
- `WorkflowsSection.svelte` — workflows prédéfinis/personnalisés.
- `PromptsSection.svelte` — bibliothèque de prompts `/nom`.
- `McpSection.svelte` / `ToolsSection.svelte` — serveurs MCP (builtins + externes) et politiques par outil.
- `WebSearchSection.svelte` — clé API Brave Search + sources par défaut.
- `DocsSection.svelte` — sites de documentation indexés (`@docs:`).
- `WorkspacesSection.svelte` — profils de workspace (instructions façon CLAUDE.md, alternative UI à `JARVIS.md`).

### `src/frontend/shared/`

- `types.ts` — **miroir manuel** des types de config backend (`src/backend/config/config-manager.ts`) : `JarvisConfig`, `ModelItem`, `RuleItem`, `SpecializedAgent`, `TodoItem`, `WebSearchConfig`, etc. À garder synchronisé à la main à chaque champ de config ajouté côté backend.
- `commands.ts` — registre des commandes `/` et mentions `@` proposées par l'autocomplétion du chat (`SLASH_COMMANDS`, `AT_MENTIONS`, `matchTrigger`, `filterCommands`).
- `constants.ts` — `APP_NAME` et constantes globales.
- `utils.ts` — utilitaires partagés.

### `src/frontend/lib/vscode-api.ts`

Wrapper autour de `acquireVsCodeApi()` (posté une seule fois, réutilisé partout) — `postMessage`, `getState`/`setState` pour la persistance d'état webview.

## Comment démarrer

1. Installer les dépendances : `npm install`
2. Build webview : `npm run build:webview` (ou `npm run watch:webview` pour le hot-reload en dev)
3. `F5` dans VS Code pour ouvrir l'Extension Development Host et voir la webview réelle.
4. Tests frontend : `npx vitest run test/frontend/` — montent `App.svelte` via `@testing-library/svelte` (`happy-dom`) et simulent les messages backend→webview avec `window.dispatchEvent(new MessageEvent('message', { data }))` (voir `test/frontend/approval-diff-review.test.ts`, `test/frontend/todo-list.test.ts`).

## Notes techniques

- Svelte **5** en mode runes (`$state`, `$derived`, `$effect`, `$props()`) — pas de Svelte 4 legacy syntax.
- Build piloté par Vite → `dist/webview/assets/app.js` + `app.css`, chargés par l'extension host via `localResourceRoots` avec un nonce CSP strict.
- Styles pilotés par les variables CSS natives de VS Code (`--vscode-*`) pour la compatibilité thème clair/sombre.
- Aucune dépendance de state management externe : tout passe par les runes Svelte 5 dans `App.svelte`, descendu en props aux enfants.
