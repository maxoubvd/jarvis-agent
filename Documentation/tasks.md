# Jarvis Agent - Liste de tâches

Ce document récapitule l'ensemble des tâches prévues pour le projet, organisées par phase de développement. Les tâches déjà réalisées sont cochées.

## 0. État du projet actuel

- [x] Initialisation du projet avec `package.json`, `tsconfig.json`, `vite.config.ts`
- [x] Ajout de `svelte.config.js`, `postcss.config.js`, `tailwind.config.js`
- [x] Mise en place de `.gitignore` et `.env.example`
- [x] Ajout d'un `README.md` de démarrage
- [x] Création d'un document de récapitulatif `initialisation.md`
- [x] Base de structure `src/` créée
- [x] Fichiers `jarvis/jarvis-config.json` et `jarvis/.jarvisignore` créés

---

## 1. Phase 1 : Setup & Fondations (MVP Core)

### 1.1. Projet VS Code et build

- [x] Initialiser le projet VS Code Extension
- [x] Créer `src/extension.ts` comme point d'entrée
- [x] Configurer TypeScript (`tsconfig.json`)
- [x] Ajouter `package.json` avec scripts de build et packaging
- [x] Ajouter `.gitignore`
- [x] Ajouter un manifeste VS Code complet si nécessaire (`package.json` de l'extension + contributes)
- [x] Ajouter la configuration de debug VS Code (`.vscode/launch.json`)
- [x] Isoler le dev host avec `disableExtensions: true`
- [x] Corriger la compilation ESM / Node16 pour `@modelcontextprotocol/sdk`

### 1.2. Frontend Webview

- [x] Configurer Svelte + Vite
- [x] Configurer Tailwind CSS
- [x] Créer `src/frontend/index.html`
- [x] Créer `src/frontend/main.ts`
- [x] Créer `src/frontend/App.svelte`
- [x] Créer un composant `ChatPanel.svelte`
- [x] Créer un composant `Sidebar.svelte`
- [x] Créer un composant `TokenGauge.svelte`
- [x] Créer un composant `ThinkingBlock.svelte`
- [x] Créer des composants de dashboard de base (`Analytics`, `TokenStats`, `Performance`)
- [x] Créer des utilitaires frontend (`lib/utils.ts`, `shared/utils.ts`, `shared/constants.ts`, `shared/types.ts`)
- [ ] Ajouter un thème VS Code intégré et les variables CSS natives
- [ ] Intégrer le build Vite pour générer `dist/webview`

### 1.3. Backend & architecture

- [x] Créer une base de backend `src/backend/core/extension.ts`
- [x] Créer un client MCP de base `src/backend/core/mcp/client.ts`
- [x] Créer les outils MCP de base :
  - [x] `read_file` (`fileSystem.ts`)
  - [ ] `write_file`
  - [x] `terminal` (`terminal.ts`)
  - [x] `git` (`git.ts`)
  - [x] `webSearch` (`webSearch.ts`)
- [x] Créer l'index d'export des outils MCP (`mcp/index.ts`, `tools/index.ts`)
- [x] Créer les abstractions de modèle IA (`src/backend/models/abstract.ts`, `config.ts`, `index.ts`)
- [x] Ajouter des providers de base :
  - [x] `Ollama`
  - [x] `OpenRouter`
- [ ] Ajouter le support d'un provider local supplémentaire si nécessaire
- [ ] Ajouter la gestion de configuration dynamique des modèles via `jarvis-config.json`

### 1.4. Documentation et configuration Jarvis

- [x] Créer `jarvis/jarvis-config.json`
- [x] Créer `.env.example`
- [x] Créer `jarvis/.jarvisignore`
- [x] Créer `initialisation.md`
- [ ] Créer un document `tasks.md` (en cours)

### 1.5. Tests de base

- [ ] Ajouter la configuration de tests unitaires (`vitest`, `@testing-library/svelte`, etc.)
- [ ] Créer des tests unitaires pour le backend et le frontend
- [ ] Vérifier le build et exécuter un premier test

---

## 2. Phase 2 : Actions & Sécurité

### 2.1. Actions terminales

- [ ] Implémenter l'outil terminal MCP complet
- [ ] Capturer stdout/stderr en temps réel
- [ ] Afficher les résultats de commandes dans l'UI ou le chat
- [ ] Ajouter la validation de sécurité avant exécution

### 2.2. Lecture et modification de fichiers

- [ ] Implémenter `write_file`
- [ ] Implémenter `edit_file`
- [ ] Valider les chemins pour empêcher l'accès hors workspace
- [ ] Ajouter la gestion des erreurs en cas de permission manquante

### 2.3. HITL (Human-in-the-Loop)

- [ ] Créer le système HITL Manager
- [ ] Implémenter les modes : `strict`, `modéré`, `libre`
- [ ] Ajouter la configuration HITL dans `jarvis-config.json`
- [ ] Ajouter des confirmations utilisateur pour les actions sensibles

### 2.4. Sandbox et secrets

- [ ] Créer `SandboxManager`
- [ ] Ajouter la validation de path et la protection des symlinks
- [ ] Implémenter `SecretScrubber`
- [ ] Ajouter les patterns de secrets par défaut
- [ ] Configurer le scrubbing par provider

### 2.5. Checkpoints Git

- [ ] Créer `CheckpointManager`
- [ ] Implémenter la création de checkpoints Git
- [ ] Implémenter rollback via `git stash` / tags
- [ ] Ajouter une UI / commandes pour rollback
- [ ] Ajouter notifications de checkpoint

---

## 3. Phase 3 : Agentic & Auto-TDD

### 3.1. Tools personnalisés et agents

- [ ] Implémenter le système de tools JSON personnalisés
- [ ] Charger les outils depuis `jarvis-tools/`
- [ ] Créer les agents spécialisés de base (`@QA-Agent`, `@Doc-Agent`, `@API-Agent`)
- [ ] Implémenter les mentions `@agent` dans le chat
- [ ] Ajouter un gestionnaire d'agents pour orchestrer les actions

### 3.2. Auto-TDD Loop

- [ ] Créer l'`AutoTDDManager`
- [ ] Implémenter l'exécution de tests depuis l'IA
- [ ] Ajouter l'analyse des erreurs de test
- [ ] Générer des corrections ciblées
- [ ] Ajouter un système de tentative limitée (`maxAttempts`)
- [ ] Ajouter la prise en charge de frameworks : `jest`, `mocha`, `vitest`

### 3.3. Workflows

- [ ] Créer des workflows prédéfinis : `dev-feature`, `bug-fix`, `code-review`
- [ ] Implémenter l'exécution séquentielle de workflows
- [ ] Ajouter la gestion des dépendances entre tâches
- [ ] Ajouter des workflows pour la création de projet et la documentation

---

## 4. Phase 4 : Analytics & Contexte

### 4.1. Analytics

- [ ] Créer la structure des fichiers de stats dans `.vscode/jarvis/`
- [ ] Implémenter `AnalyticsCollector`
- [ ] Suivre les tokens par modèle et session
- [ ] Suivre les actions et les résultats
- [ ] Ajouter un dashboard UI Svelte
- [ ] Afficher graphiques et métriques
- [ ] Ajouter export JSON/CSV
- [ ] Ajouter réinitialisation des stats

### 4.2. Contexte et RAG

- [ ] Ajouter la commande `@file` pour lire un fichier précis
- [ ] Ajouter la commande `@docs` pour récupérer la documentation
- [ ] Créer un index sémantique local basique
- [ ] Ajouter la recherche sémantique via embeddings
- [ ] Ajouter l'augmentation de prompt (RAG)
- [ ] Configurer le provider local d'embeddings

### 4.3. Evaluation des prompts

- [ ] Ajouter l'auto-évaluation des prompts
- [ ] Ajouter le scoring des prompts
- [ ] Proposer des améliorations automatiques

---

## 5. Phase 5 : Optimisation & fonctionnalités avancées

### 5.1. Parsing et pruning

- [ ] Intégrer `web-tree-sitter`
- [ ] Ajouter les grammaires pour un langage initial (TypeScript / JavaScript)
- [ ] Implémenter le `ContextPruner` basé AST
- [ ] Ajouter la sélection automatique de stratégie de pruning
- [ ] Intégrer le pruning au `TokenCounter`

### 5.2. RAG et embeddings

- [ ] Compléter le RAG local
- [ ] Ajouter les embeddings (par exemple `all-minilm`)
- [ ] Ajouter la recherche de snippets similaires
- [ ] Améliorer l'augmentation de contexte

### 5.3. Interface avancée

- [ ] Créer une `Inline Diff View`
- [ ] Ajouter un raccourci `Cmd+K` pour les diffs
- [ ] Créer un système de plugins
- [ ] Implémenter le chargement dynamique de plugins
- [ ] Ajouter la recherche web avancée
- [ ] Ajouter les micro-tâches automatiques

### 5.4. Qualité et performance

- [ ] Optimiser les performances de l'UI
- [ ] Réduire l'utilisation de tokens pour les petits modèles
- [ ] Ajouter des tests de performance
- [ ] Ajouter des tests d'intégration et e2e

---

## 6. Documentation et livraison

- [ ] Documenter l'installation et le build
- [ ] Documenter la configuration des providers IA
- [ ] Documenter `.jarvisignore` et `.env.example`
- [ ] Documenter les commandes VS Code disponibles
- [ ] Documenter les workflows et agents
- [ ] Créer un guide MVP pour l'utilisateur
- [ ] Préparer le packaging `vsce`
- [ ] Préparer une version beta ou release candidate
