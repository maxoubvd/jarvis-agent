# Spécifications Fonctionnelles et Techniques

Projet : Extension VS Code "Agentique" (Nom de code : Jarvis / Jarvis-Agent)

## 1. Vision et Objectifs

**Description** : Une extension VS Code de pointe agissant comme un ingénieur logiciel autonome. Elle combine la rapidité et la confidentialité des modèles locaux (Ollama) avec la puissance des modèles cloud (OpenRouter), le tout orchestré par le Model Context Protocol (MCP).

**Inspirations** : Continue.dev, Claude Code, Antigravity, Mistral Vibe, Codex.

**Objectif Principal** : Réduire drastiquement le temps de création, de refactoring et de débogage de projets complets en offrant une interface fluide, un contexte parfait, et une automatisation poussée.

**Philosophie** :
- Contrôle total de l'utilisateur (transparence sur chaque action)
- Thématique native VS Code (intégration seamless)
- Sécurité "local-first" (données et traitement en local par défaut)
- Automatisation avec retour d'expérience (apprentissage des préférences utilisateur)

**Public Cible** : Développeurs full-stack, architectes logiciels, équipes DevOps, et toute personne cherchant à accélérer son workflow de développement.

## 2. Interface Utilisateur (Frontend / Webview)

**Stack Technique** :
- **Framework** : Svelte 4.x (pour sa réactivité et sa légèreté)
- **Bundler** : Vite 5.x (build rapide et HMR)
- **Styling** : Tailwind CSS 4.x (avec thème VS Code natif)
- **State Management** : Svelte Stores (pour l'état global de l'extension)

### 2.1 Composants Principaux

#### Panneau Latéral (Sidebar)
- **Chat Markdown** :
  - Support complet du Markdown (via `marked.js` ou `svelte-markdown`)
  - Syntax highlighting pour le code (via `prism.js` ou `shiki`)
  - Copie de code en un clic
  - Références aux fichiers/lines (liens cliquables pour ouvrir dans l'éditeur)
- **Chaîne de pensée (<thinking>)** :
  - Affichage conditionnel (option désactivable)
  - Style visuel distinct (fond gris clair, police monospace)
  - Animations de streaming pour les pensées en temps réel
- **Système de Badges** :
  - Badges de statut (✅ Succès, ❌ Échec, ⚠️ Avertissement)
  - Badges de type (📄 Fichier, 🔧 Outil, 🧠 IA, ⏱️ Temps)
  - Badges de priorité (Haute/Moyenne/Basse)

#### Indicateur de Jetons (Token Jauge)
- **Affichage en temps réel** dans la barre de statut VS Code
- **Détails** :
  - Tokens utilisés dans la session courante
  - Tokens restants avant la limite du modèle
  - Répartition par type (input/output)
  - Historique des 5 dernières requêtes
- **Seuils visuels** :
  - Vert : < 50% de la limite
  - Orange : 50-80% de la limite
  - Rouge : > 80% de la limite

## 3. Cœur IA et Routage (Backend)

**Stack Technique** :
- **Runtime** : Node.js 20.x (LTS)
- **Environnement** : Extension Host VS Code (processus séparé)
- **API** : VS Code Extension API
- **Gestion des dépendances** : npm/yarn/pnpm

### 3.1. Configuration des Modèles

**Support Multi-Providers** :
- **Abstraction via interface `IModelProvider`** pour faciliter l'ajout de nouveaux providers
- **Configuration dynamique** via `jarvis-config.json`

**Providers Supportés** :

| Provider | Type | Modèles Pré-configurés | API Key Requise |
|----------|------|------------------------|-----------------|
| Ollama | Local | qwen2.5-coder:7b, mistral-coder:7b, deepseek-coder:6.7b | ❌ Non |
| OpenRouter | Cloud | deepseek-coder-v3, gpt-4o, claude-3-5-sonnet | ✅ Oui |
| Mistral API | Cloud | mistral-large, codestral | ✅ Oui |


### 3.2. Streaming et Gestion des Tokens

**Fonctionnalités** :
- **Streaming en temps réel** : Réception et affichage progressif des réponses
- **Compteur de tokens bidirectionnel** : Comptage des tokens input (prompt + contexte) et output (réponse)
- **Gestion des limites** : Avertissement quand approche de la limite du modèle
- **Cache des réponses** : Mémorisation des dernières réponses pour éviter de re-compter

### 3.3. Auto-TDD Loop

**Algorithme de la Boucle Auto-TDD** :
```
1. RECEVOIR TÂCHE
   ↓
2. GÉNÉRER CODE (avec contexte pertinent)
   ↓
3. ÉCRIRE/ÉDITER FICHIER
   ↓
4. EXÉCUTER TESTS (via npm test, jest, mocha, etc.)
   ↓
5. ANALYSER RÉSULTATS
   ├── SI TOUS LES TESTS PASSENT → ✅ TERMINER
   └── SI ÉCHEC → 
       ├── Analyser stderr/test output
       ├── Identifier la cause de l'échec
       ├── Générer une correction ciblée
       └── RECOMMENCER À ÉTAPE 2 (max 5 tentatives)
```

**Gestion des Erreurs Courantes** :
- **Tests qui ne passent pas** : Analyse du diff entre attendu et réel
- **Erreurs de syntaxe** : Utilisation du linter (ESLint, TypeScript) pour des corrections rapides
- **Dependencies manquantes** : Détection et suggestion d'installation via npm/yarn
- **Timeout** : Augmentation progressive du timeout ou suggestion à l'utilisateur

## 4. Capacités Agentiques & MCP

**Intégration MCP** :
- Utilisation du **Model Context Protocol (MCP)** pour standardiser les interactions entre l'IA et les outils
- **Avantages** : Interopérabilité avec d'autres outils MCP, modularité, extensibilité


### 4.1. Outils Système (File System)

**Outils MCP de base** : 

- read_file : Use this tool if you need to view the contents of an existing file.
- create_new_file: Create a new file. Only use this when a file doesn't exist and should be created
- run_terminal_command : Run a terminal command in the current directory. The shell is not stateful and will not remember any previous commands. When a command is run in the background ALWAYS suggest using shell commands to stop it; NEVER suggest using Ctrl+C. When suggesting subsequent shell commands ALWAYS format them in shell command blocks. Do NOT perform actions requiring special/admin privileges. IMPORTANT: To edit files, use Edit/MultiEdit tools instead of bash commands (sed, awk, etc). Choose terminal commands and scripts optimized for win32 and x64 and shell powershell.exe.
- file_glob_search : Search for files recursively in the project using glob patterns. Supports ** for recursive directory search. Will not show many build, cache, secrets dirs/files (can use ls tool instead). Output may be truncated; use targeted patterns
- view_diff : View the current diff of working changes
- read_currently_open_file : Read the currently open file in the IDE. If the user seems to be referring to a file that you can't see, or is requesting an action on content that seems missing, try using this tool.
- ls : List files and folders in a given directory
- fetch_url_content : Can be used to view the contents of a website using a URL. Do NOT use this for files.
- request_rule : Use this tool to retrieve additional 'rules' that contain more context/instructions based on their descriptions. Available rules: No rules available.
- read_skill : Use this tool to read the content of a skill by its name. Skills contain detailed instructions for specific tasks. The skill name should match one of the available skills listed below:
- search_web : Performs a web search, returning top results. Use this tool sparingly - only for questions that require specialized, external, and/or up-to-date knowledege. Common programming questions do not require web search.
- edit_existing_file : Use this tool to edit an existing file. If you don't know the contents of the file, read it first. When addressing code modification requests, present a concise code snippet that emphasizes only the necessary changes and uses abbreviated placeholders for unmodified sections. For example: ```language /path/to/file // ... existing code ... {{ modified code here }} // ... existing code ... {{ another modification }} // ... rest of code ... ``` In existing files, you should always restate the function or class that the snippet belongs to: ```language /path/to/file // ... existing code ... function exampleFunction() { // ... existing code ... {{ modified code here }} // ... rest of function ... } // ... rest of code ... ``` Since users have access to their complete file, they prefer reading only the relevant modifications. It's perfectly acceptable to omit unmodified portions at the beginning, middle, or end of files using these "lazy" comments. Only provide the complete file when explicitly requested. Include a concise explanation of changes unless the user specifically asks for code only. This tool CANNOT be called in parallel with any other tools, including itself
- single_find_and_replace : Performs exact string replacements in a file. IMPORTANT: - ALWAYS use the `read_file` tool just before making edits, to understand the file's up-to-date contents and context. The user can also edit the file while you are working with it. - This tool CANNOT be called in parallel with any other tools, including itself - When editing text from `read_file` tool output, ensure you preserve exact whitespace/indentation. - Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked. - Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable, for instance. WARNINGS: - When not using `replace_all`, the edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`. - The edit will likely fail if you have not recently used the `read_file` tool to view up-to-date file contents.
- grep_search : Performs a regular expression (regex) search over the repository using ripgrep. Will
- Serveur MCP git : git add, git commit, git diff, git push, git branch, git checkout, git stash, git switch, git status, git cherry-pick, git delete, etc.
- Memory (Knowledge Graph)
  - create_entities : Create multiple new entities in the knowledge graph
  - create_relations : Create multiple new relations between entities in the knowledge graph. Relations should be in active voice
  - add_observations : Add new observations to existing entities in the knowledge graph
  - delete_entities : Delete multiple entities and their associated relations from the knowledge graph
  - delete_observations : Delete specific observations from entities in the knowledge graph
  - delete_relations : Delete multiple relations from the knowledge graph
  - read_graph : Read the entire knowledge graph
  - search_nodes : Search for nodes in the knowledge graph based on a query
  - open_nodes : Open specific nodes in the knowledge graph by their names

**Sécurité Intégrée** :
- **Vérification `.jarvisignore`** avant chaque opération
- **Validation du sandboxing** (accès uniquement au workspace)
- **Journalisation** de toutes les opérations

### 4.2. Environnement & Auto-Correction

#### Run Scripts & Terminal

**Fonctionnalités** :
- **Exécution de commandes shell** avec **approval obligatoire** (configurable via HITL)
- **Capture du stdout/stderr** en temps réel
- **Streaming de la sortie** dans le chat
- **Timeout configurable** (défaut : 30 secondes)

**Commandes Supportées** :
- Commandes simples : `ls -la`, `git status`
- Scripts npm : `npm test`, `npm run build`
- Commandes composées : `git add . && git commit -m "message"`

#### Web Search

**Fonctionnalités** :
- **Recherche internet** pour documentation, stacks overflow, etc.
- **Sources configurables** : Google, Stack Overflow, MDN, documentation officielle
- **Filtrage des résultats** : Exclusion des sites non pertinents
- **Cache des recherches** : Éviter les requêtes dupliquées

## 5. Personnalisation Avancée (Agents & Workflows)

**Philosophie** : Permettre aux utilisateurs de **créer leurs propres agents spécialisés**, **définir des workflows personnalisés**, et **appliquer des règles métier** pour garantir la cohérence du code.

### 5.1. Création Modulaire

#### Tools & Skills

**Système de Tools Personnalisés** :
- **Définition via JSON** : Création de nouveaux outils sans coder
- **Intégration avec MCP** : Les outils personnalisés sont exposés comme des outils MCP
- **Scripts locaux** : Possibilité d'exécuter des scripts Node.js/Shell

#### Agents Spécialisés

**Agents Prédéfinis** :

| Agent | Description | Outils Utilisés | Cas d'Usage |
|-------|-------------|----------------|-------------|
| @QA-Agent | Agent de Qualité | Linter, Tests, Coverage | Revue de code, détection de bugs |
| @Doc-Agent | Agent de Documentation | Markdown, Doxygen | Génération de docs, commentaires |
| @Refactor-Agent | Agent de Refactoring | AST, Linter, Tests | Amélioration du code existant |
| @Security-Agent | Agent de Sécurité | Scrubber, Audit | Détection de vulnérabilités |
| @Perf-Agent | Agent de Performance | Profiling, Benchmark | Optimisation du code |

**Système d'Appel d'Agents** :
- **Mentions** : Utilisation de `@nom-agent` dans le chat pour activer un agent spécifique
- **Auto-détection** : L'extension peut suggérer un agent basé sur le contexte
- **Collaboration** : Plusieurs agents peuvent travailler ensemble sur une tâche

### 5.2. Règles & Contexte (RAG & AST)

#### Workflows

**Séquences d'Actions Prédéfinies** :

| Workflow | Étapes | Description |
|----------|--------|-------------|
| **Dev Feature** | Planifier → Coder → Tester → Commiter | Développement d'une nouvelle fonctionnalité |
| **Bug Fix** | Analyser → Reproduire → Corriger → Tester | Résolution d'un bug |
| **Code Review** | Lire Code → Exécuter Tests → Analyser Coverage → Suggérer Améliorations | Revue complète d'un PR |
| **Refactor** | Analyser → Planifier → Appliquer Changements → Tester | Refactoring de code legacy |
| **Setup Project** | Initialiser → Configurer → Installer Dépendances → Créer Structure | Création d'un nouveau projet |

#### Règles

**Application des Règles** :
- **Toujours appliquer les règles**
- **Vérification en temps réel** : Analyse du code pendant l'écriture
- **Feedback instantané** : Surlignage des violations dans l'éditeur
- **Correction automatique** : Proposition de fixes pour les règles simples
- **Rapport de conformité** : Génération d'un rapport après chaque modification

#### Parsing AST (Tree-sitter)

**Intégration de Tree-sitter** :
- **Parsing en temps réel** : Analyse syntaxique du code pendant l'édition
- **Extraction de contexte intelligent** : Envoi uniquement des parties pertinentes du code à l'IA
- **Navigation dans le code** : Saut rapide entre définitions et utilisations

**Langages Supportés** :
- JavaScript, TypeScript, Python, Java, Go, Rust, C++, C#, PHP, Ruby

#### Base Vectorielle Locale (RAG)

**Implémentation du RAG** :
- **Indexation automatique** : Les fichiers du projet sont indexés en arrière-plan
- **Recherche sémantique** : Trouver des snippets de code similaires
- **Augmentation de contexte** : Ajout des résultats pertinents au prompt

## 6. Sécurité, Fiabilité & Confidentialité (Sandboxing)

**Principes de Sécurité** :
- **Moins de privilèges par défaut** : L'extension n'a accès qu'au workspace ouvert
- **Transparence totale** : Toutes les actions sont journalisées et visibles
- **Contrôle utilisateur** : L'utilisateur a toujours le dernier mot
- **Local-first** : Les données sensibles ne quittent jamais la machine (sauf si explicitement configuré)

### 6.1. Protection du Système

#### `.jarvisignore` (Fichier d'Exclusion)

**Fonctionnement** :
- **Auto-génération** : Création automatique lors de la première activation
- **Format** : Identique à `.gitignore` (syntaxe des patterns Git)
- **Priorité** : Plus restrictif que `.gitignore` (un fichier ignoré par `.jarvisignore` ne peut pas être accès, même s'il est tracked par Git)

**Contenu par défaut** :
```ignore
# Jarvis Ignore File - Fichiers strictement invisibles pour l'IA
# Généré automatiquement - Modifiable manuellement

# Environnement et secrets
.env
.env.*
*.env
!.env.example

# Dépendances
node_modules/
vendor/
bower_components/

# Build artifacts
dist/
build/
out/
*.min.js
*.min.css

# Cache et temporaires
.cache/
.tmp/
*.tmp
*.swp
.DS_Store

# IDE et éditeur
.idea/
.vscode/
*.sublime-workspace
*.sublime-project

# OS
*.log
*.bak
*.backup

# Sécurité
*.pem
*.key
*.crt
*.pfx
secrets/
credentials/

# Bases de données
*.db
*.sqlite
*.sqlite3

# Jarvis interne
.jarvis/
.jarvisignore
jarvis-*.json
```

**Gestion du `.jarvisignore`** :
- **Édition manuelle** : L'utilisateur peut modifier le fichier à tout moment
- **Validation automatique** : Vérification de la syntaxe après modification
- **Synchronisation** : Prise en compte immédiate des changements

**Commandes VS Code** :
- `Jarvis: Generate .jarvisignore` - Régénère le fichier avec les patterns recommandés
- `Jarvis: Add to .jarvisignore` - Ajoute le fichier sélectionné à `.jarvisignore`
- `Jarvis: Remove from .jarvisignore` - Retire un pattern de `.jarvisignore`

#### Sandboxing (Isolation du Workspace)

**Mécanismes de Sécurité** :

| Mécanisme | Description | Implémentation |
|-----------|-------------|----------------|
| **Workspace Root** | Restriction à la racine du workspace VS Code | `vscode.workspace.workspaceFolders[0].uri.fsPath` |
| **Path Validation** | Vérification que tous les chemins sont dans le workspace | `path.startsWith(workspaceRoot)` |
| **Symlink Protection** | Détection et blocage des symlinks sortants | `fs.lstat().isSymbolicLink()` |
| **Parent Directory Check** | Empêche `../` de sortir du workspace | `path.normalize().startsWith(workspaceRoot)` |

**Gestion des Workspaces Multi-Dossiers** :
- **Support complet** : Chaque dossier du workspace a son propre `.jarvisignore`
- **Isolation** : Un agent ne peut pas accéder aux fichiers d'un autre dossier du workspace sans permission explicite
- **Configuration par dossier** : Les règles peuvent être différentes pour chaque dossier

#### Scrubbing (Filtrage des Secrets)

**Types de Secrets Détectés** :

| Type | Pattern | Exemple |
|------|---------|---------|
| Clés API | `[a-zA-Z0-9]{32,}` | `sk-abcdef1234567890abcdef1234567890` |
| Tokens JWT | `eyJ[A-Za-z0-9-_=]+\[.A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| Clés privées | `-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----` | `-----BEGIN RSA PRIVATE KEY-----` |
| Mots de passe | `(password|passwd|pwd)[=:"\s][^
]{4,}` | `password: "mysecret123"` |
| Secrets AWS | `AKIA[0-9A-Z]{16}` | `AKIAIOSFODNN7EXAMPLE` |
| Secrets GitHub | `ghp_[a-zA-Z0-9]{36}` | `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |

**Comportements par Provider** :
- **Local (Ollama)** : Pas de scrubbing par défaut (les données restent locales)
- **Cloud (OpenRouter, OpenAI, etc.)** : Scrubbing toujours activé
- **Option de bypass** : L'utilisateur peut désactiver temporairement pour un prompt spécifique

### 6.2. "Time Travel" (Checkpointing Git)

**Concept** : Sauvegarde automatique de l'état du projet avant toute modification importante, permettant un rollback instantané en cas d'erreur.

**Mécanismes de Checkpoint** :

| Type | Déclencheur | Méthode | Persistance |
|------|-------------|---------|-------------|
| **Action Unique** | Avant une action dangereuse | `git stash` | Session |
| **Plan d'Action** | Avant un workflow complet | `git commit` | Permanent |
| **Session** | Début de session | `git stash` | Session |
| **Manuel** | Commande utilisateur | `git commit` | Permanent |

**Nommage des Checkpoints** :
- **Format** : `jarvis/checkpoint-[timestamp]-[type]-[description]`
- **Exemples** :
  - `jarvis/checkpoint-20260703-123456-action-rm-node_modules`
  - `jarvis/checkpoint-20260703-123500-workflow-dev-feature-user-auth`
  - `jarvis/checkpoint-20260703-123600-session-start`

**Intégration avec l'UI** :
- **Bouton "Rollback"** dans la sidebar avec :
  - Liste des checkpoints disponibles
  - Aperçu des changements (diff)
  - Confirmation avant rollback
- **Notifications** : Avertissement quand un checkpoint est créé
- **Commande VS Code** : `Jarvis: List Checkpoints` et `Jarvis: Rollback to Checkpoint`

d.json"        |
|                                          |
| 🔴 12:00:00 - session-start               |
|     → Stash: jarvis/checkpoint-120000    |
|     "Début de session"                   |
|                                          |
+------------------------------------------+
| [✅ Appliquer Rollback] [❌ Annuler]        |
+------------------------------------------+
```

**Configuration du Time Travel** :
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
      "actionCheckpoints": 24,    // 24 heures
      "workflowCheckpoints": 7,   // 7 jours
      "sessionCheckpoints": 1,    // 1 session
      "manualCheckpoints": 30     // 30 jours
    },
    "storage": {
      "useGitStash": true,\n      "useGitTags": true
    }
  }
}
```

**Gestion des Conflits** :
- **Détection automatique** : Si des changements non-commités existent avant un rollback
- **Options** :
  - **Stash** : Sauvegarder les changements actuels avant rollback
  - **Discard** : Ignorer les changements actuels
  - **Cancel** : Annuler le rollback
- **Notification** : L'utilisateur est toujours averti avant toute perte de données

## 7. Stratégies d'Optimisation pour Petits Modèles (Local / Ollama)

**Problématique** : Les petits modèles (ex: qwen2.5-coder:7b, mistral-coder:7b) ont des **limites** :
- **Contexte limité** : 32K tokens max (contre 200K+ pour les grands modèles)
- **Capacité de raisonnement réduite** : Moins bons pour les tâches complexes
- **Précision moindre** : Plus de risques d'erreurs ou d'hallucinations
- **Pas de connaissances externes** : Pas d'accès à internet ou à des données récentes

**Objectif** : **Maximiser l'efficacité** des petits modèles en :
1. **Réduisant la complexité** des tâches (Micro-Tâches)
2. **Améliorant la structure** des requêtes (JSON Mode, Few-Shot)
3. **Optimisant le contexte** (Context Pruning)
4. **Validant systématiquement** les résultats

### 7.1. Micro-Tâches (Task Decomposition)

**Principe** : Découper les demandes complexes en **sous-tâches atomiques** que le modèle peut traiter individuellement.

**Exemple de Découpage** :
```
Demande utilisateur:
"Crée une application web complète avec frontend React, backend Node.js, 
base de données MongoDB, et déploiement sur AWS"

Découpage en Micro-Tâches:
1. Analyser les requirements et créer un plan d'architecture
2. Initialiser le projet (structure de dossiers, package.json)
3. Créer la configuration TypeScript
4. Développer le frontend React (composants, hooks)
5. Développer le backend Node.js (routes, contrôleurs)
6. Configurer MongoDB (schémas, connexions)
7. Écrire les tests unitaires
8. Configurer le déploiement AWS
9. Documenter le projet
```

**Stratégie de Découpage** :

| Type de Tâche | Niveau de Découpage | Exemple |
|---------------|---------------------|---------|
| **Création de fonction** | 1 tâche | "Écris une fonction de tri en JS" |
| **Création de composant** | 1 tâche | "Crée un composant Button avec props" |
| **Création de page** | 2-3 tâches | 1. Structure HTML, 2. Style CSS, 3. Logique JS |
| **Création de module** | 3-5 tâches | 1. Types/Interfaces, 2. Fonctions, 3. Tests |
| **Création d'application** | 10+ tâches | Voir exemple ci-dessus |


**Avantages des Micro-Tâches** :
- **Meilleure qualité** : Le modèle se concentre sur une seule chose à la fois
- **Moins d'erreurs** : Réduction de la complexité cognitive
- **Meilleur contexte** : Chaque tâche peut avoir son propre contexte ciblé
- **Validation intermediate** : Possibilité de valider chaque étape
- **Reprise facile** : Si une tâche échoue, on peut repartir de là

### 8.2. JSON Mode & Few-Shot Prompting

**JSON Mode** : Forcer le modèle à répondre dans un **format structuré et parseable**.

**Avantages** :
- **Parsing garanti** : Pas d'ambiguïté dans la réponse
- **Validation facile** : On peut valider la structure avant de traiter
- **Intégration simplifiée** : Les réponses peuvent être directement utilisées dans le code


**Few-Shot Prompting** : Fournir des **exemples concrets** avant la demande réelle pour guider le modèle.


**Validation des Réponses JSON (Version 2.1 - Avec Nettoyeur Robuste)** :

**⚠️ Problème identifié** : Les modèles locaux (Qwen 2.5 7B) ne respectent pas toujours parfaitement le format JSON.

**✅ Solution** : Nettoyeur multi-étapes intégré

### 8.3. Context Pruning (AST-based)

**Problème** : Envoyer des **fichiers entiers** à l'IA consomme beaucoup de tokens et peut submerger les petits modèles.

**Solution** : Envoyer uniquement les **parties pertinentes** du code, extraites via l'analyse AST (Abstract Syntax Tree).

**Niveaux de Context Pruning** :

| Niveau | Description | Tokens Économisés | Utilisation |
|--------|-------------|------------------|-------------|
| **Aucun** | Fichier complet | 0% | Debugging complexe |
| **Fonction** | Fonction actuelle + imports | 70-80% | Modification de fonction |
| **Classe** | Classe complète + dépendances | 50-60% | Modification de classe |
| **Module** | Module complet | 30-40% | Ajout de fonctionnalité |
| **Projet** | Projet entier (filtré) | 10-20% | Refactoring global |


## 9. Roadmap

**Approche** : Développement **incrémental et itératif** avec des livrables fonctionnels à chaque phase.
**Priorisation** : Commencer par le **MVP (Minimum Viable Product)** puis ajouter des fonctionnalités avancées.
**Estimation** : Chaque phase devrait prendre **2-4 semaines** selon la disponibilité.

### 9.1. Phase 1: Setup & Fondations (MVP Core)

**Objectif** : Créer une extension VS Code **fonctionnelle de base** avec interface utilisateur et gestion des modèles.

**Livrables** :
- [ ] Boilerplate VS Code Extension avec TypeScript
- [ ] Configuration de base (Svelte + Vite + Tailwind)
- [ ] Architecture backend (Node.js + MCP)
- [ ] Interface utilisateur (Sidebar, Chat Panel)
- [ ] **Token Jauge** (indicateur en temps réel)
- [ ] **`.jarvisignore`** (génération et gestion)
- [ ] Configuration des modèles (Ollama + OpenRouter)
- [ ] Streaming de base des réponses

**Tâches Détaillées** :

| # | Tâche | Priorité | Complexité | Dépendances |
|---|-------|----------|------------|-------------|
| 1 | Initialiser le projet VS Code Extension | ⭐⭐⭐⭐⭐ | Moyenne | Aucune |
| 2 | Configurer TypeScript, ESLint, Prettier | ⭐⭐⭐⭐ | Faible | 1 |
| 3 | Ajouter Svelte + Vite pour les webviews | ⭐⭐⭐⭐ | Moyenne | 1 |
| 4 | Configurer Tailwind CSS avec thème VS Code | ⭐⭐⭐ | Faible | 3 |
| 5 | Créer la structure backend (core/, services/) | ⭐⭐⭐⭐ | Moyenne | 1 |
| 6 | Implémenter le client MCP de base | ⭐⭐⭐⭐ | Élevée | 5 |
| 7 | Ajouter les outils MCP de base (read_file, write_file) | ⭐⭐⭐⭐ | Moyenne | 6 |
| 8 | Créer le Chat Panel (affichage Markdown) | ⭐⭐⭐⭐ | Moyenne | 4 |
| 9 | Implémenter le Token Counter | ⭐⭐⭐⭐ | Moyenne | 6 |
| 10 | Ajouter l'indicateur de tokens dans la status bar | ⭐⭐⭐ | Faible | 9 |
| 11 | Générer et gérer le .jarvisignore | ⭐⭐⭐ | Moyenne | 5 |
| 12 | Configurer les providers de modèles | ⭐⭐⭐⭐ | Moyenne | 5 |
| 13 | Implémenter le streaming des réponses | ⭐⭐⭐ | Moyenne | 6 |
| 14 | Ajouter la sélection de modèle dans l'UI | ⭐⭐⭐ | Faible | 12 |
| 15 | Tests unitaires de base | ⭐⭐⭐ | Moyenne | 1-14 |

**Critères de Validation** :
- [ ] L'extension s'installe et s'active dans VS Code
- [ ] Le chat affiche les réponses en Markdown
- [ ] Le Token Jauge fonctionne et met à jour en temps réel
- [ ] Le `.jarvisignore` bloque effectivement l'accès aux fichiers listés
- [ ] Les modèles Ollama et OpenRouter répondent correctement
- [ ] Le streaming affiche les réponses mot par mot

---

### 9.2. Phase 2: Actions & Sécurité

**Objectif** : Ajouter les **capacités d'action** (terminal, modification de fichiers) avec un **système de sécurité robuste**.

**Livrables** :
- [ ] **Terminal intégré** avec exécution de commandes
- [ ] **Lecture/Écriture de fichiers** avec validation
- [ ] **HITL (Human-in-the-Loop)** avec 3 modes
- [ ] **Time Travel** (Git Checkpoints)
- [ ] **Scrubbing** des secrets
- [ ] **Sandboxing** complet
- [ ] Système de notifications et confirmations

**Tâches Détaillées** :

| # | Tâche | Priorité | Complexité | Dépendances |
|---|-------|----------|------------|-------------|
| 1 | Implémenter l'outil terminal MCP | ⭐⭐⭐⭐⭐ | Élevée | Phase 1 |
| 2 | Ajouter la capture stdout/stderr | ⭐⭐⭐⭐ | Élevée | 1 |
| 3 | Implémenter edit_file (pas juste write_file) | ⭐⭐⭐⭐ | Élevée | Phase 1 |
| 4 | Créer le système HITL Manager | ⭐⭐⭐⭐⭐ | Élevée | Phase 1 |
| 5 | Ajouter les 3 modes HITL (strict, modéré, libre) | ⭐⭐⭐⭐ | Moyenne | 4 |
| 6 | Implémenter la configuration HITL | ⭐⭐⭐ | Moyenne | 4 |
| 7 | Créer le SandboxManager | ⭐⭐⭐⭐⭐ | Élevée | Phase 1 |
| 8 | Implémenter la validation des paths | ⭐⭐⭐⭐ | Élevée | 7 |
| 9 | Ajouter la détection de symlinks | ⭐⭐⭐ | Moyenne | 7 |
| 10 | Implémenter le SecretScrubber | ⭐⭐⭐⭐ | Élevée | Phase 1 |
| 11 | Ajouter les patterns par défaut | ⭐⭐⭐ | Moyenne | 10 |
| 12 | Configurer le scrubbing par provider | ⭐⭐⭐ | Moyenne | 10 |
| 13 | Créer le CheckpointManager | ⭐⭐⭐⭐ | Élevée | Phase 1 |
| 14 | Implémenter la création de checkpoints | ⭐⭐⭐⭐ | Élevée | 13 |
| 15 | Ajouter le rollback via git stash/tag | ⭐⭐⭐⭐ | Élevée | 13 |
| 16 | Créer l'UI du bouton Rollback | ⭐⭐⭐ | Moyenne | 13 |
| 17 | Ajouter les notifications de sécurité | ⭐⭐⭐ | Faible | 4,7,10 |
| 18 | Tests de sécurité (sandboxing, scrubbing) | ⭐⭐⭐⭐ | Élevée | 1-17 |

**Critères de Validation** :
- [ ] Les commandes terminales s'exécutent avec confirmation HITL
- [ ] Les fichiers ne peuvent pas être lus/écrits hors du workspace
- [ ] Le `.jarvisignore` bloque effectivement l'accès
- [ ] Les secrets sont filtrés avant envoi au cloud
- [ ] Les checkpoints Git sont créés automatiquement
- [ ] Le rollback fonctionne et restaure l'état exact
- [ ] Les 3 modes HITL fonctionnent comme attendu

---

### 9.3. Phase 3: Agentic & TDD

**Objectif** : Ajouter les **capacités agentiques** avancées et la **boucle Auto-TDD**.

**Livrables** :
- [ ] **Configuration JSON pour les Tools**
- [ ] **Boucle Auto-TDD** complète
- [ ] **Gestion des erreurs** intelligente
- [ ] **Système de workflows** simples
- [ ] **Agents spécialisés** de base (@QA-Agent, @Doc-Agent)
- [ ] Intégration avec les tests (Jest, Mocha, etc.)

**Tâches Détaillées** :

| # | Tâche | Priorité | Complexité | Dépendances |
|---|-------|----------|------------|-------------|
| 1 | Implémenter le système de Tools personnalisés | ⭐⭐⭐⭐ | Élevée | Phase 2 |
| 2 | Ajouter le chargement des outils depuis jarvis-tools/ | ⭐⭐⭐ | Moyenne | 1 |
| 3 | Créer l'Auto-TDD Loop Manager | ⭐⭐⭐⭐⭐ | Élevée | Phase 2 |
| 4 | Implémenter l'exécution des tests | ⭐⭐⭐⭐ | Élevée | Phase 2 |
| 5 | Ajouter l'analyse des erreurs de test | ⭐⭐⭐⭐ | Élevée | 4 |
| 6 | Implémenter la génération de corrections | ⭐⭐⭐⭐ | Élevée | 5 |
| 7 | Configurer le nombre max de tentatives | ⭐⭐⭐ | Moyenne | 3 |
| 8 | Ajouter la gestion des timeouts | ⭐⭐⭐ | Moyenne | 3 |
| 9 | Créer les agents spécialisés de base | ⭐⭐⭐ | Moyenne | Phase 2 |
| 10 | Implémenter le système d'appel d'agents | ⭐⭐⭐⭐ | Élevée | 9 |
| 11 | Ajouter les mentions @agent dans le chat | ⭐⭐⭐ | Moyenne | 10 |
| 12 | Créer les workflows prédéfinis | ⭐⭐⭐ | Moyenne | Phase 2 |
| 13 | Implémenter l'exécution séquentielle de workflows | ⭐⭐⭐⭐ | Élevée | 12 |
| 14 | Ajouter la gestion des dépendances entre tâches | ⭐⭐⭐ | Moyenne | 13 |
| 15 | Tests de la boucle TDD | ⭐⭐⭐⭐ | Élevée | 1-14 |

**Critères de Validation** :
- [ ] Les outils personnalisés peuvent être définis et utilisés
- [ ] La boucle Auto-TDD fonctionne pour les cas simples
- [ ] Les erreurs de tests sont analysées et corrigées automatiquement
- [ ] Les agents spécialisés répondent correctement à leurs mentions
- [ ] Les workflows s'exécutent séquentiellement
- [ ] Maximum 5 tentatives avant abandon

---

### 9.4. Phase 4: Analytics & Context

**Objectif** : Ajouter la **couche d'analytics** et améliorer la **gestion du contexte**.

**Livrables** :
- [ ] **Dashboard Analytics** complet
- [ ] **Suivi des tokens** par modèle et session
- [ ] **Métriques de performance** (taux de succès, temps moyen)
- [ ] **@file et @docs** dans le chat
- [ ] **Recherche de code similaire** (RAG basique)
- [ ] **Auto-évaluation** des prompts
- [ ] Export des données

**Tâches Détaillées** :

| # | Tâche | Priorité | Complexité | Dépendances |
|---|-------|----------|------------|-------------|
| 1 | Créer la structure des fichiers de stats | ⭐⭐⭐ | Moyenne | Phase 1 |
| 2 | Implémenter l'AnalyticsCollector | ⭐⭐⭐⭐ | Élevée | 1 |
| 3 | Ajouter le tracking des tokens | ⭐⭐⭐⭐ | Élevée | 2 |
| 4 | Implémenter le tracking des actions | ⭐⭐⭐⭐ | Élevée | 2 |
| 5 | Créer le Dashboard UI (Svelte) | ⭐⭐⭐⭐ | Élevée | Phase 1 |
| 6 | Ajouter les graphiques (Chart.js) | ⭐⭐⭐ | Moyenne | 5 |
| 7 | Implémenter les onglets du dashboard | ⭐⭐⭐ | Moyenne | 5 |
| 8 | Ajouter @file pour lire des fichiers | ⭐⭐⭐ | Moyenne | Phase 2 |
| 9 | Implémenter @docs pour la documentation | ⭐⭐⭐ | Moyenne | Phase 2 |
| 10 | Configurer le RAG local (Vectra) | ⭐⭐⭐⭐ | Élevée | Phase 2 |
| 11 | Implémenter l'indexation des fichiers | ⭐⭐⭐ | Moyenne | 10 |
| 12 | Ajouter la recherche sémantique | ⭐⭐⭐⭐ | Élevée | 10 |
| 13 | Implémenter l'auto-évaluation | ⭐⭐⭐ | Moyenne | 2 |
| 14 | Ajouter le scoring des prompts | ⭐⭐⭐ | Moyenne | 13 |
| 15 | Implémenter l'export des données | ⭐⭐⭐ | Moyenne | 2 |
| 16 | Ajouter la réinitialisation des stats | ⭐⭐⭐ | Faible | 2 |
| 17 | Tests des fonctionnalités analytics | ⭐⭐⭐ | Moyenne | 1-16 |

**Critères de Validation** :
- [ ] Le dashboard affiche correctement les stats
- [ ] Les tokens sont comptés précisément
- [ ] @file et @docs fonctionnent dans le chat
- [ ] La recherche RAG retourne des résultats pertinents
- [ ] L'export génère des fichiers JSON/CSV valides
- [ ] L'auto-évaluation propose des améliorations

---

### 9.5. Phase 5: Optimisation & Fonctionnalités Avancées

**Objectif** : **Optimiser** les performances et ajouter des **fonctionnalités avancées** pour les utilisateurs power users.

**Livrables** :
- [ ] **Tree-sitter** pour le parsing AST
- [ ] **Context Pruning** avancé
- [ ] **RAG local** complet avec embeddings
- [ ] **Inline Diff** (Cmd+K)
- [ ] **Système de plugins**
- [ ] **Extensibilité** (Tools, Agents, Workflows)
- [ ] **Intégration Web Search** avancée
- [ ] **Micro-Tâches** automatiques

**Tâches Détaillées** :

| # | Tâche | Priorité | Complexité | Dépendances |
|---|-------|----------|------------|-------------|
| 1 | Intégrer Tree-sitter (web-tree-sitter) | ⭐⭐⭐⭐ | Élevée | Phase 3 |
| 2 | Ajouter les grammaires pour les langages supportés | ⭐⭐⭐ | Moyenne | 1 |
| 3 | Implémenter le ContextPruner AST-based | ⭐⭐⭐⭐⭐ | Très Élevée | 1 |
| 4 | Ajouter la sélection automatique de stratégie | ⭐⭐⭐⭐ | Élevée | 3 |
| 5 | Intégrer le pruning avec le Token Counter | ⭐⭐⭐⭐ | Élevée | 3, Phase 2 |
| 6 | Compléter le RAG local | ⭐⭐⭐⭐ | Élevée | Phase 4 |
| 7 | Ajouter les embeddings (all-minilm) | ⭐⭐⭐ | Moyenne | 6 |
| 8 | Implémenter l'augmentation de contexte | ⭐⭐⭐⭐ | Élevée | 6 |
| 9 | Créer l'Inline Diff View | ⭐⭐⭐ | Moyenne | Phase 2 |
| 10 | Implémenter Cmd+K pour les diffs | ⭐⭐⭐⭐ | Élevée | 9 |
| 11 | Ajouter le système de plugins | ⭐⭐⭐⭐ | Élevée | Phase 3 |
| 12 | Créer l'API des plugins | ⭐⭐⭐⭐ | Élevée | 11 |
| 13 | Implémenter le chargement dynamique | ⭐⭐⭐ | Moyenne | 11 |
| 14 | Ajouter la Web Search avancée | ⭐⭐⭐ | Moyenne | Phase 2 |
| 15 | Implémenter le caching des résultats | ⭐⭐⭐ | Moyenne | 14 |
| 16 | Ajouter les Micro-Tâches automatiques | ⭐⭐⭐⭐ | Élevée | Phase 3 |
| 17 | Implémenter la détection de complexité | ⭐⭐⭐⭐ | Élevée | 16 |
| 18 | Optimisations de performance | ⭐⭐⭐ | Moyenne | Toutes |
| 19 | Tests complets de toutes les fonctionnalités | ⭐⭐⭐⭐ | Élevée | Toutes |

**Critères de Validation** :
- [ ] Le Context Pruning réduit les tokens de 50%+ pour les petits modèles
- [ ] Le RAG retourne des résultats précis
- [ ] L'Inline Diff fonctionne avec Cmd+K
- [ ] Les plugins peuvent être installés et utilisés
- [ ] Les Micro-Tâches sont générées automatiquement
- [ ] Les performances sont optimales (pas de lag dans l'UI)


### 10 Ressources et Références

**Documentation Officielle** :
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Model Context Protocol (MCP)](https://github.com/modelcontextprotocol/spec)
- [Svelte Documentation](https://svelte.dev/docs)
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [Vite Documentation](https://vitejs.dev/)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

**Librairies et Outils** :
- [Ollama](https://ollama.ai/) - Modèles locaux
- [OpenRouter](https://openrouter.ai/) - API de modèles cloud
- [web-tree-sitter](https://github.com/Paulrberg/web-tree-sitter) - Tree-sitter pour le browser
- [Vectra](https://github.com/GenisysAI/vectra) - Base vectorielle locale
- [marked.js](https://marked.js.org/) - Parsing Markdown
- [Chart.js](https://www.chartjs.org/) - Graphiques

**Projets Inspirants** :
- [Continue.dev](https://github.com/continuedev/continue) - Extension VS Code AI
- [Claude Code](https://github.com/sourcegraph/claude-code) - (anciennement)
- [Antigravity](https://github.com/antigravity-ai/antigravity) - Agent de code
- [Mistral Vibe](https://github.com/mistralai/vibe) - CLI Agent
- [Codex](https://github.com/features/codex) - (GitHub)

**Communauté** :
- [VS Code Extensions](https://code.visualstudio.com/docs/editor/extension-gallery)
- [Awesome VS Code](https://github.com/viatsko/awesome-vscode)
- [MCP Community](https://github.com/modelcontextprotocol/community)

**Outils de Développement** :
- [VS Code Extension Generator](https://code.visualstudio.com/api/get-started/extension-generator)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [VS Code Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Yeoman Generator for VS Code](https://github.com/microsoft/vscode-generator)