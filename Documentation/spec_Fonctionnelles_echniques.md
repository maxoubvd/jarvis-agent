# Spécifications Fonctionnelles et Techniques

**Version** : 2.1 (Intégration du retour d'expérience et solutions aux défis techniques)
**Dernière modification** : 03/07/2026
**Statut** : Prêt pour l'implémentation avec solutions aux points de vigilance identifiés

Projet : Extension VS Code "Agentique" (Nom de code : Jarvis / Jarvis-Agent)

---

## 📌 **Retour d'Expérience & Améliorations (Version 2.1)**

### ✅ **Ce qui rend ce document exceptionnel**

**Analyse externe** (validée par un ingénieur senior) :

1. **Architecture orientée "Data" et Benchmarking (Section 7)** ⭐⭐⭐⭐⭐
   - La mise en place de **métriques précises** (taux de succès, tokens/action, temps moyen) et d'un **dashboard de télémétrie locale** apporte une rigueur scientifique indispensable
   - Transformation d'une simple extension en un **véritable environnement d'analyse de données appliquées au code**
   - Permet d'évaluer et benchmarker sérieusement des modèles IA lors de déploiements d'outils internes

2. **Gestion chirurgicale des petits modèles (Section 8)** ⭐⭐⭐⭐⭐
   - `TaskDecomposer` pour créer des **micro-tâches** : solution parfaite pour les limites des modèles 7B-14B
   - **Context Pruning** via AST (Tree-sitter) : réduction drastique de la consommation de tokens
   - Algorithme `selectPruningStrategy` particulièrement **élégant et efficace**

3. **Sécurité "By Design" (Section 6)** ⭐⭐⭐⭐⭐
   - Approche **systémique** avec `SandboxManager`, `.jarvisignore` auto-généré
   - **Scrubber** avec regex précises pour éviter la fuite de secrets
   - Architecture capable de passer un **audit de sécurité informatique strict**

4. **Structures de données claires** ⭐⭐⭐⭐⭐
   - Définition **exhaustive** des schémas JSON pour configurations, agents, workflows
   - Système **hautement modulaire** et extensible

---

### ⚠️ **Points de Vigilance & Solutions (Version 2.1)**

#### 1️⃣ **Le piège des dépendances natives (Tree-sitter & Vectra)**

**Problème identifié** : Dans l'environnement VS Code (Electron/Node.js), l'intégration de modules utilisant du **C++ ou Rust compilé** (bases vectorielles, parsing natif) peut être un cauchemar lors du build avec Vite.

**✅ Solution implémentée** :
- **Tree-sitter** : Utilisation de **`web-tree-sitter`** (version WebAssembly) → **100% JavaScript/WASM**
- **Embeddings** : Remplacement de `@tensorflow/tfjs` (lourd) par **`@xenova/transformers`** (WASM, léger, 100% compatible browser)

**Nouvelle configuration des dépendances** :
```json
{
  "dependencies": {
    "web-tree-sitter": "^0.20.0",
    "@xenova/transformers": "^2.16.0"  // Alternative à @tensorflow/tfjs
  }
}
```

---

#### 2️⃣ **L'illusion du JSON Mode à 100%**

**Problème identifié** : Même avec un excellent prompt "Few-Shot", les modèles locaux (Qwen 2.5 7B) oublient parfois de fermer une accolade ou ajoutent du texte Markdown autour.

**✅ Solution implémentée** : Nettoyeur JSON robuste intégré à `validateJsonResponse` :

```typescript
function extractJsonFromString(input: string): string | null {
  const firstBrace = input.indexOf('{');
  if (firstBrace === -1) return null;
  const lastBrace = input.lastIndexOf('}');
  if (lastBrace === -1) return null;
  
  return input.substring(firstBrace, lastBrace + 1)
    .replace(/^```(json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/^json\s*:?\s*/i, '')
    .trim();
}
```

---

#### 3️⃣ **Timeline ambitieuse**

**Problème identifié** : Le planning initial sous-estime la complexité de l'API VS Code pour le Terminal et le Sandboxing.

**✅ Solution implémentée** : **Réduction impitoyable du scope du MVP**

**Nouvelle Timeline réaliste** :
- **MVP Phase 1 (2 semaines)** : Un seul provider (Ollama), un seul langage (TypeScript)
- **MVP Phase 2 (2-3 semaines)** : Terminal + Sandboxing basique + Time Travel (stash only)
- **Phases 3-5** : Ajout progressif des fonctionnalités avancées

**Règle d'or** : "Un langage, un provider, une fonctionnalité à la fois"

---

## 🎯 **Bilan Version 2.1**

✅ **Feuille de route digne d'un ingénieur senior**
✅ **Solutions concrètes** aux 3 défis techniques majeurs
✅ **Timeline réaliste** avec scope MVP bien défini
✅ **70% des spécifications** = Extension la plus avancée du marché

**Statut** : ✅ **PRÊT POUR L'IMPLÉMENTATION**

---

## 1. Vision et Objectifs

**Description** : Une extension VS Code de pointe agissant comme un ingénieur logiciel autonome. Elle combine la rapidité et la confidentialité des modèles locaux (Ollama) avec la puissance des modèles cloud (OpenRouter), le tout orchestré par le Model Context Protocol (MCP).

**Inspirations** : Continue.dev, Claude Code, Antigravity, Mistral Vibe, Codex.

**Objectif Principal** : Réduire drastiquement le temps de création, de refactoring et de débogage de projets complets en offrant une interface fluide, un contexte parfait, et une automatisation poussée.

**Philosophie** :
- 100% gratuit/open-source (Licence MIT)
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

**Architecture Frontend** :
```
frontend/
├── components/
│   ├── ChatPanel.svelte       # Panneau principal de chat
│   ├── TokenGauge.svelte      # Indicateur de tokens
│   ├── Sidebar.svelte         # Barre latérale avec onglets
│   ├── ThinkingBlock.svelte   # Affichage de la chaîne de pensée
│   └── Dashboard/
│       ├── Analytics.svelte   # Dashboard principal
│       ├── TokenStats.svelte  # Statistiques d'utilisation des tokens
│       └── Performance.svelte # Métriques de performance
├── lib/
│   ├── theme.css              # Variables CSS natives VS Code
│   └── utils.ts               # Fonctions utilitaires frontend
└── App.svelte                 # Point d'entrée principal
```

### 2.1. Thématisation VS Code
- **Utilisation stricte des variables CSS natives** via `:root` et `var(--vscode-*)`
- **Exemple de variables utilisées** :
  ```css
  :root {
    --vscode-foreground: var(--vscode-editor-foreground);
    --vscode-background: var(--vscode-editor-background);
    --vscode-primary: var(--vscode-button-background);
    --vscode-secondary: var(--vscode-badge-background);
    --vscode-error: var(--vscode-editorError-foreground);
    --vscode-success: var(--vscode-testing-iconPassed);
  }
  ```
- **Adaptation automatique** au thème VS Code (Light/Dark/High Contrast)

### 2.2. Composants Principaux

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
- **Implémentation** : `vscode.window.createStatusBarItem()`

#### Dashboard Analytics Local
**Onglets dédiés** :

| Onglet | Description | Métriques Affichées |
|--------|-------------|---------------------|
| **Tokens** | Utilisation par modèle et session | Tokens input/output, coût estimé, répartition par modèle |
| **Performance** | Succès des suggestions | Taux d'acceptation, temps moyen par tâche, nombre de corrections |
| **Historique** | Journal des actions | Liste des actions effectuées, durée, résultat |
| **Modèles** | Comparaison des modèles | Succès/échecs par modèle, temps de réponse moyen |

**Fonctionnalités** :
- **Graphiques interactifs** (via Chart.js)
- **Filtrage par période** (aujourd'hui, cette semaine, ce mois)
- **Export des données** (JSON/CSV)
- **Réinitialisation des stats** (bouton dédié)

**Exemple de visualisation** :
```
+------------------------------------------+
| Dashboard Jarvis                         |
+------------------------------------------+
| [📊 Tokens] [📈 Performance] [🕒 Historique] |
+------------------------------------------+
| Tokens utilisés aujourd'hui:             |
| ████████████░░ DeepSeek (15,420)    78%   |
| ████░░░░░░░░░░ Qwen2.5 (4,580)     22%   |
|                                          |
| Taux de succès: 87%  Temps gagné: 3h 42m |
+------------------------------------------+
| Dernières actions:                        |
| ✅ write_file (app.ts) - 12:45            |
| ✅ terminal (npm test) - 12:46            |
| ❌ edit_file (config.js) - 12:50          |
+------------------------------------------+
```

## 3. Cœur IA et Routage (Backend)

**Stack Technique** :
- **Runtime** : Node.js 20.x (LTS)
- **Environnement** : Extension Host VS Code (processus séparé)
- **API** : VS Code Extension API
- **Gestion des dépendances** : npm/yarn/pnpm

**Architecture Backend** :
```
backend/
├── core/
│   ├── mcp/                  # Intégration Model Context Protocol
│   │   ├── client.ts         # Client MCP principal
│   │   ├── tools/            # Implémentations des outils MCP
│   │   │   ├── fileSystem.ts # read_file, write_file, edit_file, list_directory
│   │   │   ├── terminal.ts   # Exécution de commandes shell
│   │   │   ├── webSearch.ts  # Recherche internet
│   │   │   └── git.ts        # Opérations Git (commit, stash, etc.)
│   │   └── index.ts          # Export des outils MCP
│   ├── models/               # Gestion des modèles IA
│   │   ├── providers/        # Fournisseurs de modèles
│   │   │   ├── ollama.ts     # Client Ollama local
│   │   │   ├── openrouter.ts # Client OpenRouter
│   │   │   └── abstract.ts   # Interface IModelProvider
│   │   ├── config.ts         # Configuration des modèles
│   │   └── index.ts          # Export des providers
│   ├── streaming/            # Gestion du streaming
│   │   ├── tokenCounter.ts   # Compteur de tokens en temps réel
│   │   └── streamHandler.ts  # Gestion des streams de réponse
│   └── utils/                # Utilitaires
│       ├── sandbox.ts       # Vérification du sandboxing
│       ├── scrubber.ts       # Filtrage des secrets
│       └── logger.ts         # Journalisation
├── services/
│   ├── autoTDD.ts           # Boucle Auto-TDD
│   ├── hitl.ts              # Human-in-the-Loop
│   ├── checkpoint.ts        # Time Travel (Git Checkpoints)
│   └── analytics.ts         # Collecte des métriques
└── extension.ts             # Point d'entrée principal
```

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

**Exemple de configuration** (`jarvis-config.json`) :
```json
{
  "models": {
    "default": "deepseek-coder-v3",
    "providers": {
      "ollama": {
        "enabled": true,
        "baseUrl": "http://localhost:11434",
        "models": [
          { "name": "qwen2.5-coder:7b", "contextLength": 32768 },
          { "name": "mistral-coder:7b", "contextLength": 32768 }
        ]
      },
      "openrouter": {
        "enabled": true,
        "apiKey": "sk-or-v1-...",
        "baseUrl": "https://openrouter.ai/api/v1",
        "models": [
          { "name": "deepseek-coder-v3", "contextLength": 262144 },
          { "name": "gpt-4o", "contextLength": 131072 }
        ]
      }
    }
  }
}
```

### 3.2. Streaming et Gestion des Tokens

**Fonctionnalités** :
- **Streaming en temps réel** : Réception et affichage progressif des réponses
- **Compteur de tokens bidirectionnel** : Comptage des tokens input (prompt + contexte) et output (réponse)
- **Gestion des limites** : Avertissement quand approche de la limite du modèle
- **Cache des réponses** : Mémorisation des dernières réponses pour éviter de re-compter

**Implémentation du Token Counter** :
```typescript
class TokenCounter {
  private inputTokens: number = 0;
  private outputTokens: number = 0;
  private modelContextLength: number;

  constructor(modelConfig: ModelConfig) {
    this.modelContextLength = modelConfig.contextLength;
  }

  addInputTokens(count: number): void {
    this.inputTokens += count;
    this.checkLimit();
  }

  addOutputTokens(count: number): void {
    this.outputTokens += count;
    this.checkLimit();
  }

  private checkLimit(): void {
    const total = this.inputTokens + this.outputTokens;
    const percentage = (total / this.modelContextLength) * 100;
    
    if (percentage > 90) {
      vscode.window.showWarningMessage(
        `Attention : ${this.modelContextLength - total} tokens restants (${percentage.toFixed(1)}%)`
      );
    }
  }

  reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
  }
}
```

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

**Configuration** :
```json
{
  "autoTDD": {
    "enabled": true,
    "maxAttempts": 5,
    "testCommand": "npm test",
    "testFramework": "jest",
    "timeout": 120000, // 2 minutes
    "onFailure": {
      "analyzeLogs": true,
      "suggestFix": true,
      "askUser": false
    }
  }
}
```

**Gestion des Erreurs Courantes** :
- **Tests qui ne passent pas** : Analyse du diff entre attendu et réel
- **Erreurs de syntaxe** : Utilisation du linter (ESLint, TypeScript) pour des corrections rapides
- **Dependencies manquantes** : Détection et suggestion d'installation via npm/yarn
- **Timeout** : Augmentation progressive du timeout ou suggestion à l'utilisateur

### 3.4. Modèles Optimisés

**Recommandations par Cas d'Usage** :

| Cas d'Usage | Modèle Recommandé | Pourquoi |
|-------------|-------------------|----------|
| Développement Python | deepseek-coder-v3 | Meilleure compréhension du code Python, long contexte |
| Développement JavaScript/TypeScript | qwen2.5-coder:7b | Léger, rapide, bon pour le frontend |
| Refactoring complexe | gpt-4o | Meilleure compréhension globale du codebase |
| Documentation | mistral-large | Bon équilibre prix/performance pour le texte |
| Debugging | claude-3-5-sonnet | Excellente analyse des erreurs |

**Ajout Dynamique de Modèles** :
- **Via l'interface** : Sélection dans la palette de commandes (`Ctrl+Shift+P` → "Jarvis: Add Model")
- **Via configuration** : Ajout manuel dans `jarvis-config.json`
- **Validation automatique** : Vérification que le modèle existe auprès du provider

## 4. Capacités Agentiques & MCP

**Intégration MCP** :
- Utilisation du **Model Context Protocol (MCP)** pour standardiser les interactions entre l'IA et les outils
- **Avantages** : Interopérabilité avec d'autres outils MCP, modularité, extensibilité
- **Version supportée** : MCP 1.0+

### 4.1. Outils Système (File System)

**Outils MCP de base** :

| Outil | Description | Paramètres | Retour |
|-------|-------------|------------|--------|
| `read_file` | Lit le contenu d'un fichier | `{ path: string, encoding?: string }` | `{ content: string, stats: FileStats }` |
| `write_file` | Écrit un fichier (création ou écrasement) | `{ path: string, content: string }` | `{ success: boolean, path: string }` |
| `edit_file` | Modifie une partie d'un fichier | `{ path: string, start: Position, end: Position, newText: string }` | `{ success: boolean, path: string }` |
| `list_directory` | Liste les fichiers/dossiers | `{ path: string, recursive?: boolean }` | `{ items: FileItem[], stats: DirStats }` |
| `delete_file` | Supprime un fichier | `{ path: string }` | `{ success: boolean }` |

**Sécurité Intégrée** :
- **Vérification `.jarvisignore`** avant chaque opération
- **Validation du sandboxing** (accès uniquement au workspace)
- **Journalisation** de toutes les opérations

**Exemple d'utilisation** :
```typescript
// Implémentation de read_file
async function readFileTool(params: { path: string }): Promise<MCPResult> {
  const { path } = params;
  
  // Vérification sandboxing
  if (!await canAccessFile(path)) {
    throw new Error(`Accès refusé : ${path} est hors du workspace ou dans .jarvisignore`);
  }
  
  // Lecture du fichier
  const content = await fs.promises.readFile(path, 'utf-8');
  const stats = await fs.promises.stat(path);
  
  return {
    content: content,
    stats: {
      size: stats.size,
      mtime: stats.mtime,
      isDirectory: stats.isDirectory()
    }
  };
}
```

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

**Implémentation** :
```typescript
async function executeTerminalCommand(command: string): Promise<ExecutionResult> {
  // Vérification HITL
  const approval = await checkHITLApproval('terminal', { command });
  if (!approval.granted) {
    return { success: false, error: 'Refusé par l\'utilisateur' };
  }

  // Création du terminal
  const terminal = vscode.window.createTerminal({
    name: `Jarvis: ${command.substring(0, 20)}...`,
    shellPath: '/bin/bash' // ou cmd.exe sur Windows
  });
  
  // Envoi de la commande
  terminal.sendText(command);
  
  // Capture de la sortie (simplifiée)
  return new Promise((resolve) => {
    // Logique pour capturer stdout/stderr
    // Timeout après 30s
    setTimeout(() => {
      resolve({ success: true, output: capturedOutput });
    }, 30000);
  });
}
```

#### Web Search

**Fonctionnalités** :
- **Recherche internet** pour documentation, stacks overflow, etc.
- **Sources configurables** : Google, Stack Overflow, MDN, documentation officielle
- **Filtrage des résultats** : Exclusion des sites non pertinents
- **Cache des recherches** : Éviter les requêtes dupliquées

**Configuration** :
```json
{
  "webSearch": {
    "enabled": true,
    "providers": ["google", "stackoverflow", "mdn"],
    "maxResults": 5,
    "timeout": 10000,
    "blacklist": ["w3schools.com", "geeksforgeeks.org"]
  }
}
```

**Implémentation** :
```typescript
async function webSearchTool(query: string): Promise<SearchResult[]> {
  // Vérification HITL pour les recherches internet
  if (!await checkHITLApproval('web_search', { query })) {
    return [];
  }
  
  // Utilisation de l'API de recherche (ex: Google Custom Search)
  const results = await searchProvider.search(query, {
    maxResults: 5,
    safeSearch: true
  });
  
  // Filtrage et nettoyage des résultats
  return results
    .filter(r => !isBlacklisted(r.url))
    .map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      source: r.domain
    }));
}
```

### 4.3. Contrôle Utilisateur (HITL - Human-in-the-Loop)

**Système de Niveaux d'Autorisation** :

| Niveau | Description | Actions Requérant Approval | Exemple |
|--------|-------------|-----------------------------|---------|
| **Strict** | Sécurité maximale | **Toutes les actions** | Lecture de fichier, écriture, terminal |
| **Modéré** | Équilibre | Actions dangereuses | rm, git push, npm install -g |
| **Libre** | Confiance totale | Aucune | Toutes les actions autorisées |

**Configuration HITL** (`jarvis-config.json`) :
```json
{
  "hitl": {
    "mode": "moderate", // strict | moderate | free
    "alwaysAskFor": [
      "terminal:rm",
      "terminal:git push",
      "terminal:npm install --global",
      "write_file:.env",
      "edit_file:package.json"
    ],
    "neverAskFor": [
      "read_file",
      "list_directory"
    ],
    "sessionAllowances": [],
    "globalPolicies": {
      "git": {
        "allow": ["status", "diff", "log"],
        "ask": ["push", "reset --hard", "rebase"]
      },
      "terminal": {
        "allow": ["ls", "cd", "cat"],
        "ask": ["rm", "mv", "chmod"]
      }
    }
  }
}
```

**Implémentation du Système HITL** :
```typescript
class HITLManager {
  private mode: 'strict' | 'moderate' | 'free';
  private alwaysAsk: Set<string>;
  private neverAsk: Set<string>;
  private globalPolicies: Record<string, { allow: string[], ask: string[] }>;

  async checkApproval(actionType: string, params: any): Promise<ApprovalResult> {
    // Mode Libre : toujours approuvé
    if (this.mode === 'free') {
      return { granted: true, reason: 'Mode Libre activé' };
    }

    // Vérification des listes explicites
    const actionKey = this.getActionKey(actionType, params);
    if (this.neverAsk.has(actionKey)) {
      return { granted: true, reason: 'Dans neverAsk' };
    }
    if (this.alwaysAsk.has(actionKey)) {
      return await this.promptUser(actionType, params);
    }

    // Vérification des politiques globales
    const policy = this.globalPolicies[actionType.split(':')[0]];
    if (policy) {
      const command = params?.command || actionType;
      if (policy.ask.some(cmd => command.includes(cmd))) {
        return await this.promptUser(actionType, params);
      }
    }

    // Mode Strict : demande toujours
    if (this.mode === 'strict') {
      return await this.promptUser(actionType, params);
    }

    // Mode Modéré : approuvé par défaut
    return { granted: true, reason: 'Mode Modéré - action sûre' };
  }

  private async promptUser(actionType: string, params: any): Promise<ApprovalResult> {
    const actionDesc = this.describeAction(actionType, params);
    const result = await vscode.window.showInformationMessage(
      `Souhaitez-vous autoriser : ${actionDesc} ?`,
      { modal: true, detail: JSON.stringify(params, null, 2) },
      "Oui", "Non", "Oui pour cette session"
    );

    if (result === "Oui") {
      return { granted: true, reason: 'Approuvé par l\'utilisateur' };
    }
    if (result === "Oui pour cette session") {
      // Ajouter à sessionAllowances
      return { granted: true, reason: 'Approuvé pour la session' };
    }
    return { granted: false, reason: 'Refusé par l\'utilisateur' };
  }
}
```

**Exemples de Prompts HITL** :
- **Terminal** : `"Souhaitez-vous exécuter : rm -rf node_modules ?"`
- **Écriture de fichier** : `"Souhaitez-vous écrire dans : src/config.prod.json ?"`
- **Git Push** : `"Souhaitez-vous pousser vers : origin/main ? (5 commits)"`

## 5. Personnalisation Avancée (Agents & Workflows)

**Philosophie** : Permettre aux utilisateurs de **créer leurs propres agents spécialisés**, **définir des workflows personnalisés**, et **appliquer des règles métier** pour garantir la cohérence du code.

### 5.1. Création Modulaire

#### Tools & Skills

**Système de Tools Personnalisés** :
- **Définition via JSON** : Création de nouveaux outils sans coder
- **Intégration avec MCP** : Les outils personnalisés sont exposés comme des outils MCP
- **Scripts locaux** : Possibilité d'exécuter des scripts Node.js/Shell

**Exemple de Tool Personnalisé** (`jarvis-tools/my-tool.json`) :
```json
{
  "name": "deploy-to-staging",
  "description": "Déploie l'application sur l'environnement de staging",
  "type": "shell",
  "command": "npm run build && scp -r dist/ user@staging:/var/www/app",
  "timeout": 300000,
  "env": {
    "NODE_ENV": "production"
  },
  "hitl": {
    "requireApproval": true,
    "warning": "Cette action va déployer en staging. Vérifiez que tout est commité."
  }
}
```

**Exemple de Tool en JavaScript** (`jarvis-tools/validate-code.js`) :
```javascript
// Tool pour valider le code selon des règles custom
module.exports = {
  name: "validate-code-style",
  description: "Valide que le code respecte les conventions de style",
  params: {
    type: "object",
    properties: {
      filePath: { type: "string", description: "Chemin du fichier à valider" }
    },
    required: ["filePath"]
  },
  execute: async ({ filePath }) => {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const errors = [];
    
    // Vérification des règles
    if (content.includes('console.log')) {
      errors.push(`Utilisation de console.log interdite dans ${filePath}`);
    }
    
    if (content.match(/[A-Z][a-z]+/g)?.length > 10) {
      errors.push(`Trop de noms en camelCase dans ${filePath}`);
    }
    
    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: []
    };
  }
};
```

#### Agents Spécialisés

**Agents Prédéfinis** :

| Agent | Description | Outils Utilisés | Cas d'Usage |
|-------|-------------|----------------|-------------|
| @QA-Agent | Agent de Qualité | Linter, Tests, Coverage | Revue de code, détection de bugs |
| @Doc-Agent | Agent de Documentation | Markdown, Doxygen | Génération de docs, commentaires |
| @Refactor-Agent | Agent de Refactoring | AST, Linter, Tests | Amélioration du code existant |
| @Security-Agent | Agent de Sécurité | Scrubber, Audit | Détection de vulnérabilités |
| @Perf-Agent | Agent de Performance | Profiling, Benchmark | Optimisation du code |

**Création d'un Agent Personnalisé** :
```json
// jarvis-agents/my-agent.json
{
  "name": "@API-Agent",
  "description": "Agent spécialisé pour l'intégration avec mon API interne",
  "prompt": "Tu es un expert en intégration API. Utilise les outils disponibles pour interagir avec l'API. Ne fais jamais d'hypothèses sur la structure des endpoints.",
  "tools": [
    "get_api_docs",
    "call_api_endpoint",
    "validate_api_response"
  ],
  "workflow": [
    "Analyser la demande",
    "Consulter la documentation API si nécessaire",
    "Appeler l'endpoint approprié",
    "Valider la réponse",
    "Retourner le résultat"
  ],
  "permissions": {
    "read_file": true,
    "write_file": false,
    "terminal": false
  }
}
```

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

**Exemple de Workflow** (`jarvis-workflows/dev-feature.json`) :
```json
{
  "name": "dev-feature",
  "description": "Développement complet d'une nouvelle fonctionnalité",
  "steps": [
    {
      "name": "Planification",
      "agent": "@Planner-Agent",
      "action": "Analyser la demande et créer un plan détaillé",
      "output": "plan.md"
    },
    {
      "name": "Codage",
      "agent": "@Coder-Agent",
      "action": "Implémenter selon le plan",
      "input": "plan.md",
      "output": "src/**/*.ts"
    },
    {
      "name": "Tests",
      "agent": "@QA-Agent",
      "action": "Écrire et exécuter les tests unitaires",
      "output": "src/**/*.test.ts"
    },
    {
      "name": "Correction",
      "agent": "@Coder-Agent",
      "action": "Corriger les échecs de tests (Auto-TDD)",
      "conditional": "if tests fail",
      "maxAttempts": 5
    },
    {
      "name": "Validation",
      "agent": "@QA-Agent",
      "action": "Exécuter tous les tests et vérifier la coverage",
      "require": "all tests pass"
    },
    {
      "name": "Commit",
      "agent": "@Git-Agent",
      "action": "Commiter les changements avec un message descriptif",
      "output": "git commit"
    }
  ],
  "onError": "pause_and_ask",
  "onComplete": "notify_user"
}
```

#### Règles (`.jarvis-rules.json`)

**Structure du Fichier de Règles** :
```json
{
  "version": "1.0",
  "extends": ["default-rules.json"],
  "rules": {
    "style": {
      "maxLineLength": 100,
      "indent": 2,
      "quotes": "single",
      "semicolons": "required",
      "trailingCommas": "es5",
      "printWidth": 100
    },
    "naming": {
      "functions": "camelCase",
      "variables": "camelCase",
      "constants": "UPPER_SNAKE_CASE",
      "classes": "PascalCase",
      "files": "kebab-case"
    },
    "forbidden": {
      "functions": ["eval", "Function", "setTimeout"],
      "modules": ["express", "http"],
      "patterns": [
        { "regex": "console\\.log", "message": "Utilisez le logger au lieu de console.log" },
        { "regex": "any", "message": "Évitez d'utiliser 'any' en TypeScript" }
      ]
    },
    "required": {
      "imports": ["@/types"],
      "tests": true,
      "documentation": {
        "functions": true,
        "classes": true
      }
    },
    "security": {
      "noSecretsInCode": true,
      "validateInputs": true,
      "sanitizeOutputs": true
    }
  },
  "exceptions": {
    "files": {
      "src/legacy/**": {
        "style": {
          "maxLineLength": 120
        }
      }
    },
    "patterns": {
      "test/**": {
        "forbidden": {
          "functions": []
        }
      }
    }
  }
}
```

**Application des Règles** :
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

**Exemple d'Extraction de Contexte** :
```typescript
// Extraction des informations pertinentes pour un fichier
async function extractRelevantContext(filePath: string, cursorPosition: Position): Promise<Context> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  const tree = parser.parse(content);
  
  // Trouver le nœud à la position du curseur
  const node = tree.rootNode.namedDescendantForPosition(cursorPosition);
  
  // Extraire le contexte pertinent
  const context: Context = {
    currentFunction: findEnclosingFunction(node, content),
    imports: extractImports(tree, content),
    relatedClasses: findRelatedClasses(node, tree, content),
    calledFunctions: findCalledFunctions(node, tree, content),
    variablesInScope: findVariablesInScope(node, tree, content)
  };
  
  return context;
}
```

**Utilisation pour le Context Pruning** :
```typescript
// Au lieu d'envoyer tout le fichier à l'IA
const fullContext = await readFile(filePath);

// On envoie uniquement ce qui est pertinent
const relevantContext = await extractRelevantContext(filePath, cursorPosition);
const prompt = `
Contexte pertinent pour la position actuelle :

Fonction actuelle :
\[code\]${relevantContext.currentFunction}\n\n[/code]

Imports utilisés :
${relevantContext.imports.join('\n')}

Variables dans la portée :
${relevantContext.variablesInScope.map(v => `- ${v.name}: ${v.type}`).join('\n')}

Tâche : ${userRequest}
`;
```

#### Base Vectorielle Locale (RAG)

**Implémentation du RAG** :
- **Indexation automatique** : Les fichiers du projet sont indexés en arrière-plan
- **Recherche sémantique** : Trouver des snippets de code similaires
- **Augmentation de contexte** : Ajout des résultats pertinents au prompt

**Configuration** :
```json
{
  "rag": {
    "enabled": true,
    "indexer": "vectra", // ou "chromadb", "lancedb"
    "embeddingModel": "all-minilm", // Modèle léger pour les embeddings
    "indexedFiles": ["src/**/*.ts", "src/**/*.js"],
    "ignoredFiles": ["node_modules/**", "dist/**", ".git/**"],
    "maxResults": 5,
    "similarityThreshold": 0.7
  }
}
```

**Exemple d'Utilisation** :
```typescript
// Recherche de code similaire
async function findSimilarCode(query: string, maxResults: number = 5): Promise<CodeSnippet[]> {
  const embeddings = await embeddingModel.embed(query);
  const results = await vectorStore.query(embeddings, maxResults);
  
  return results.map(result => ({
    filePath: result.metadata.filePath,
    line: result.metadata.line,
    content: result.metadata.content,
    similarity: result.score,
    context: result.metadata.context
  }));
}

// Utilisation dans le chat
const similarSnippets = await findSimilarCode(userQuery);
const augmentedPrompt = `
${userQuery}

Snippets de code pertinents trouvés dans le projet :
${similarSnippets.map(s => `
--- ${s.filePath}:${s.line} (similarité: ${(s.similarity * 100).toFixed(1)}%)
${s.content}
`).join('')}
`;
```

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

**Implémentation du Sandboxing** :
```typescript
class SandboxManager {
  private workspaceRoot: string;
  private jarvisIgnore: JarvisIgnore;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = this.normalizePath(workspaceRoot);
    this.jarvisIgnore = new JarvisIgnore(path.join(workspaceRoot, '.jarvisignore'));
  }

  async canAccess(path: string): Promise<AccessResult> {
    // Normalisation du chemin
    const normalizedPath = this.normalizePath(path);
    
    // Vérification 1 : Le chemin est-il dans le workspace ?
    if (!normalizedPath.startsWith(this.workspaceRoot)) {
      return {
        allowed: false,
        reason: `Chemin ${path} est hors du workspace`
      };
    }

    // Vérification 2 : Le chemin est-il dans .jarvisignore ?
    if (await this.jarvisIgnore.ignores(path)) {
      return {
        allowed: false,
        reason: `Chemin ${path} est dans .jarvisignore`
      };
    }

    // Vérification 3 : Existe-t-il des symlinks sortants ?
    if (await this.hasEscapingSymlinks(path)) {
      return {
        allowed: false,
        reason: `Chemin ${path} contient des symlinks sortants`
      };
    }

    return { allowed: true };
  }

  private normalizePath(p: string): string {
    return path.normalize(path.resolve(p)).replace(/\\/g, '/');
  }

  private async hasEscapingSymlinks(currentPath: string): Promise<boolean> {
    // Logique pour détecter les symlinks qui sortent du workspace
    const stats = await fs.promises.lstat(currentPath);
    if (stats.isSymbolicLink()) {
      const target = await fs.promises.readlink(currentPath);
      const resolved = path.resolve(path.dirname(currentPath), target);
      return !resolved.startsWith(this.workspaceRoot);
    }
    return false;
  }
}
```

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

**Implémentation du Scrubber** :
```typescript
class SecretScrubber {
  private patterns: RegExp[];
  private customPatterns: RegExp[];

  constructor() {
    // Patterns par défaut
    this.patterns = [
      /sk-[a-zA-Z0-9]{32,}/g,                     // OpenAI, OpenRouter
      /eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+/g, // JWT
      /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----[\s\S]*?-----END \1 PRIVATE KEY-----/g,
      /(?:password|passwd|pwd)[=:"\s]\S{4,}/gi,   // Mots de passe
      /AKIA[0-9A-Z]{16}/g,                        // AWS Access Key ID
      /ghp_[a-zA-Z0-9]{36}/g,                      // GitHub Personal Access Token
      /[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/g,          // Adresses IP privées
      /mysql:\/\/[^\s]+@[^\s]+\/[^\s]+/g        // URL de base de données
    ];

    // Chargement des patterns custom depuis .jarvis-secrets
    this.customPatterns = this.loadCustomPatterns();
  }

  scrub(text: string): { cleaned: string; foundSecrets: SecretMatch[] } {
    const foundSecrets: SecretMatch[] = [];
    let cleaned = text;

    // Application de tous les patterns
    [...this.patterns, ...this.customPatterns].forEach((pattern, index) => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        foundSecrets.push({
          type: this.getSecretType(pattern),
          match: match[0],
          position: match.index
        });
      });
      cleaned = cleaned.replace(pattern, '[REDACTED]');
    });

    return { cleaned, foundSecrets };
  }

  private getSecretType(pattern: RegExp): string {
    // Logique pour déterminer le type de secret
    const patternStr = pattern.toString();
    if (patternStr.includes('PRIVATE KEY')) return 'Private Key';
    if (patternStr.includes('sk-')) return 'API Key';
    if (patternStr.includes('ghp_')) return 'GitHub Token';
    if (patternStr.includes('AKIA')) return 'AWS Key';
    if (patternStr.includes('password')) return 'Password';
    if (patternStr.includes('eyJ')) return 'JWT Token';
    return 'Unknown';
  }
}
```

**Configuration du Scrubbing** (`jarvis-config.json`) :
```json
{
  "security": {
    "scrubbing": {
      "enabled": true,
      "providers": {
        "openrouter": true,
        "openai": true,
        "local": false
      },
      "customPatterns": [
        {
          "name": "Mon API Key Custom",
          "pattern": "MYAPP-[A-Z0-9]{10}",
          "replacement": "[MYAPP_REDACTED]"
        }
      ],
      "actionOnSecret": "redact_and_warn" // redact_and_warn | block_and_warn | redact_silently
    }
  }
}
```

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

**Implémentation du Time Travel** :
```typescript
class CheckpointManager {
  private workspaceRoot: string;
  private checkpoints: Checkpoint[] = [];
  private currentSessionId: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.currentSessionId = `session-${Date.now()}`;
  }

  async createCheckpoint(
    type: 'action' | 'workflow' | 'session' | 'manual',
    description: string
  ): Promise<Checkpoint> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointName = `jarvis/checkpoint-${timestamp}-${type}-${this.sanitizeDescription(description)}`;

    // Création du stash ou commit
    if (type === 'workflow' || type === 'manual') {
      // Commit pour les checkpoints permanents
      await vscode.commands.executeCommand('git.commit', {
        message: `Jarvis Checkpoint: ${description}`,
        all: true
      });
      await vscode.commands.executeCommand('git.tag', checkpointName);
    } else {
      // Stash pour les checkpoints temporaires
      await vscode.commands.executeCommand('git.stash', {
        save: true,
        name: checkpointName
      });
    }

    const checkpoint: Checkpoint = {
      id: checkpointName,
      type,
      description,
      timestamp: new Date().toISOString(),
      sessionId: this.currentSessionId,
      state: {
        branch: await this.getCurrentBranch(),
        commit: await this.getCurrentCommit()
      }
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  async rollback(checkpointId: string): Promise<RollbackResult> {
    const checkpoint = this.checkpoints.find(c => c.id === checkpointId);
    if (!checkpoint) {
      return { success: false, error: 'Checkpoint non trouvé' };
    }

    try {
      if (checkpoint.type === 'workflow' || checkpoint.type === 'manual') {
        // Rollback via git tag
        await vscode.commands.executeCommand('git.reset', '--hard', checkpoint.id);
      } else {
        // Rollback via git stash
        await vscode.commands.executeCommand('git.stash', { apply: checkpoint.id });
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listCheckpoints(): Promise<Checkpoint[]> {
    // Lister les stashs Git
    const stashes = await this.getGitStashes();
    // Lister les tags Jarvis
    const tags = await this.getJarvisTags();
    
    return [...stashes, ...tags].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  private sanitizeDescription(desc: string): string {
    return desc.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 50);
  }
}
```

**Intégration avec l'UI** :
- **Bouton "Rollback"** dans la sidebar avec :
  - Liste des checkpoints disponibles
  - Aperçu des changements (diff)
  - Confirmation avant rollback
- **Notifications** : Avertissement quand un checkpoint est créé
- **Commande VS Code** : `Jarvis: List Checkpoints` et `Jarvis: Rollback to Checkpoint`

**Bouton "Rollback" dans la Sidebar** :
```
+------------------------------------------+
| Jarvis Checkpoints                       |
+------------------------------------------+
| [🔄 Rollback] [🕒 Historique]              |
+------------------------------------------+
| Checkpoints disponibles:                 |
|                                          |
| 🟢 12:34:56 - workflow-dev-feature-auth   |
|     → Commit: abc1234                    |
|     "Développement de la feature auth"   |
|                                          |
| 🟡 12:30:00 - action-edit-config         |
|     → Stash: jarvis/checkpoint-123000    |
|     "Édition de config.prod.json"        |
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

## 7. Analyse & Optimisation des Modèles (Analytics Local)

**Philosophie** : Fournir une **transparence totale** sur l'utilisation de l'IA, permettre aux utilisateurs de **comprendre et optimiser** leurs interactions, et offrir des **insights actionnables** pour améliorer la productivité.

**Garanties** :
- **100% Local** : Aucune donnée ne quitte la machine de l'utilisateur
- **Anonymat** : Aucune information personnelle ou de projet n'est collectée
- **Contrôle** : L'utilisateur peut désactiver, réinitialiser ou exporter ses données à tout moment

### 7.1. Architecture du Dashboard

**Stockage des Données** :
- **Format** : JSON (fichiers dans `.vscode/jarvis/`)
- **Emplacement** : `.vscode/jarvis-stats.json` (statistiques globales)
- **Sessions** : `.vscode/jarvis-sessions/[session-id].json` (détails par session)
- **Backup automatique** : Sauvegarde quotidienne dans `.vscode/jarvis-backup/`

**Structure des Données** :

#### Fichier Principal (`jarvis-stats.json`)
```json
{
  "version": "1.0",
  "metadata": {
    "createdAt": "2026-07-03T00:00:00Z",
    "updatedAt": "2026-07-03T12:34:56Z",
    "jarvisVersion": "2.0.0"
  },
  "summary": {
    "totalSessions": 42,
    "totalTokens": 1542000,
    "totalTimeSaved": "23h 45m",
    "totalActions": 1250,
    "successRate": 87.2
  },
  "models": {
    "deepseek-coder-v3": {
      "tokensUsed": 1245000,
      "sessions": 35,
      "successRate": 91.5,
      "avgResponseTime": 12.5,
      "costEstimate": 45.67,
      "categories": {
        "javascript": { "tokens": 450000, "successRate": 93.2 },
        "python": { "tokens": 320000, "successRate": 89.8 },
        "typescript": { "tokens": 280000, "successRate": 92.1 }
      }
    },
    "qwen2.5-coder:7b": {
      "tokensUsed": 297000,
      "sessions": 8,
      "successRate": 78.3,
      "avgResponseTime": 8.2,
      "costEstimate": 0.00
    }
  },
  "actions": {
    "total": 1250,
    "byType": {
      "write_file": { "count": 450, "successRate": 92.4 },
      "edit_file": { "count": 380, "successRate": 88.7 },
      "terminal": { "count": 120, "successRate": 85.0 },
      "read_file": { "count": 200, "successRate": 98.0 },
      "web_search": { "count": 100, "successRate": 80.0 }
    }
  },
  "agents": {
    "@Coder-Agent": { "usage": 35, "successRate": 90.1 },
    "@QA-Agent": { "usage": 25, "successRate": 85.5 },
    "@Doc-Agent": { "usage": 15, "successRate": 95.2 }
  }
}
```

#### Fichier de Session (`jarvis-sessions/[id].json`)
```json
{
  "id": "session-20260703-120000",
  "startTime": "2026-07-03T12:00:00Z",
  "endTime": "2026-07-03T12:34:56Z",
  "duration": "34m 56s",
  "metadata": {
    "workspace": "/Users/user/projects/my-app",
    "jarvisVersion": "2.0.0",
    "vscodeVersion": "1.90.0"
  },
  "tokens": {
    "total": {
      "input": 45200,
      "output": 23400,
      "total": 68600
    },
    "byModel": {
      "deepseek-coder-v3": { "input": 45200, "output": 23400 }
    },
    "byAction": {
      "write_file": { "input": 15000, "output": 8000 },
      "edit_file": { "input": 12000, "output": 6000 }
    }
  },
  "actions": [
    {
      "id": "action-1",
      "type": "write_file",
      "timestamp": "2026-07-03T12:05:23Z",
      "params": { "path": "src/utils.ts" },
      "tokens": { "input": 5000, "output": 2500 },
      "duration": 12.5,
      "status": "success",
      "accepted": true,
      "model": "deepseek-coder-v3"
    },
    {
      "id": "action-2",
      "type": "terminal",
      "timestamp": "2026-07-03T12:15:45Z",
      "params": { "command": "npm test" },
      "tokens": { "input": 300, "output": 150 },
      "duration": 25.8,
      "status": "success",
      "accepted": true,
      "model": "deepseek-coder-v3"
    },
    {
      "id": "action-3",
      "type": "edit_file",
      "timestamp": "2026-07-03T12:20:10Z",
      "params": { "path": "src/app.ts", "start": { "line": 42, "character": 10 }, "end": { "line": 42, "character": 20 } },
      "tokens": { "input": 2500, "output": 1200 },
      "duration": 8.3,
      "status": "success",
      "accepted": false,
      "model": "deepseek-coder-v3",
      "rejectionReason": "Ne correspondait pas à mes attentes"
    }
  ],
  "conversations": [
    {
      "id": "conv-1",
      "messages": [
        {
          "role": "user",
          "content": "Crée une fonction pour trier un tableau",
          "timestamp": "2026-07-03T12:01:00Z",
          "tokens": 15
        },
        {
          "role": "assistant",
          "content": "Voici une implémentation de fonction de tri...",
          "timestamp": "2026-07-03T12:01:15Z",
          "tokens": 250,
          "model": "deepseek-coder-v3"
        }
      ]
    }
  ]
}
```

### 7.2. Métriques et Indicateurs

#### Suivi de Performance par Modèle

**Indicateurs Clés** :

| Métrique | Description | Formule | Objectif |
|----------|-------------|---------|----------|
| **Taux de Succès** | % de suggestions acceptées | (actions acceptées / actions totales) × 100 | > 85% |
| **Temps Moyen** | Temps moyen par requête | Σ(duration) / nombre de requêtes | < 15s |
| **Tokens par Action** | Efficacité token | tokens utilisés / action réussie | Minimiser |
| **Taux de Correction** | % de corrections réussies | (corrections réussies / tentatives) × 100 | > 90% |
| **Temps Gagné** | Temps économisé | Σ(temps estimé - temps réel) | Maximiser |

**Exemple de Calcul** :
```
Modèle: deepseek-coder-v3
- Taux de succès: (450 + 380 + 100) / 1250 = 74.4%
- Temps moyen: (12.5 + 8.2 + 25.8) / 10 = 15.5s
- Tokens par action réussie: 68600 / 930 = 73.76 tokens
```

**Visualisation dans le Dashboard** :
```
+---------------------------------------------------+
| Performance par Modèle                            |
+---------------------------------------------------+
| Modèle                    | Succès | Temps | Tokens |
+---------------------------------------------------+
| deepseek-coder-v3         | 91.5%  | 12.5s | 73.8  |
| qwen2.5-coder:7b          | 78.3%  | 8.2s  | 45.2  |
| mistral-coder:7b          | 85.1%  | 10.1s | 58.4  |
+---------------------------------------------------+
|                                       [📊 Graphique] |
+---------------------------------------------------+
```

#### Dashboard de Coût/Token

**Calcul des Coûts** :
- **Modèles locaux (Ollama)** : Coût = 0 (exécuté localement)
- **Modèles Cloud** : Coût = (tokens input × prix_input) + (tokens output × prix_output)

**Prix Estimés (Juillet 2026)** :

| Modèle | Prix Input ($/M tokens) | Prix Output ($/M tokens) |
|--------|------------------------|--------------------------|
| deepseek-coder-v3 | $0.15 | $0.30 |
| gpt-4o | $5.00 | $15.00 |
| claude-3-5-sonnet | $3.00 | $10.00 |
| mistral-large | $2.00 | $6.00 |

**Exemple de Calcul de Coût** :
```
Session avec deepseek-coder-v3:
- Tokens input: 45,200 → 45.2 × $0.15 = $6.78
- Tokens output: 23,400 → 23.4 × $0.30 = $7.02
- Coût total: $13.80
```

**Visualisation du Coût** :
```
+---------------------------------------------------+
| Coût par Modèle (Ce Mois)                          |
+---------------------------------------------------+
| deepseek-coder-v3    | $45.67 | ████████████░░ 78% |
| gpt-4o               | $120.45| ██████████████ 100%|
| qwen2.5-coder:7b     | $0.00  | ░░░░░░░░░░░░░░░ 0%   |
+---------------------------------------------------+
| Total estimé: $166.12                              |
| Économie vs GPT-4: $1,245.88                       |
+---------------------------------------------------+
```

**Optimisation des Coûts** :
- **Suggestions automatiques** : "Utiliser qwen2.5-coder pour les petites tâches pourrait réduire vos coûts de 80%"
- **Alertes de budget** : Notification quand un seuil de coût est atteint
- **Comparaison de modèles** : Affichage du coût estimé avant de choisir un modèle

#### Auto-évaluation et Apprentissage

**Analyse des Prompts Réussis** :
- **Historique des prompts** : Mémorisation des requêtes qui ont conduit à des solutions acceptées
- **Pattern Recognition** : Identification des structures de prompts qui fonctionnent le mieux
- **Suggestions** : Proposition de formulations de prompts optimisées

**Exemple d'Analyse** :
```json
{
  "successfulPatterns": [
    {
      "pattern": "Crée une fonction {name} qui {description} en {language}",
      "successRate": 94.2,
      "usageCount": 45,
      "avgTokens": 500,
      "example": "Crée une fonction sortArray qui trie un tableau en JavaScript"
    },
    {
      "pattern": "Corrige cette erreur: {error}",
      "successRate": 88.7,
      "usageCount": 32,
      "avgTokens": 800
    }
  ],
  "failedPatterns": [
    {
      "pattern": "Fais ceci",
      "successRate": 15.3,
      "usageCount": 12,
      "reason": "Trop vague, manque de contexte"
    }
  ],
  "recommendations": [
    "Ajouter le langage dans la requête augmente le taux de succès de 23%",
    "Inclure des exemples d'entrée/sortie améliore la qualité de 35%",
    "Spécifier le style de code réduit les corrections de 18%"
  ]
}
```

**Fonctionnalités d'Auto-évaluation** :
- **Scoring des prompts** : Note de qualité de 1 à 10 pour chaque requête
- **Feedback post-action** : "Pourquoi avez-vous rejeté cette suggestion ?" avec options prédéfinies
- **Amélioration continue** : Mise à jour des patterns en fonction du feedback utilisateur

### 7.3. Implémentation Technique

**Collecte des Métriques** :
```typescript
class AnalyticsCollector {
  private stats: JarvisStats;
  private currentSession: JarvisSession;

  constructor() {
    this.stats = this.loadStats();
    this.currentSession = this.createNewSession();
  }

  trackAction(action: ActionMetadata): void {
    const sessionAction: SessionAction = {
      id: `action-${Date.now()}`,
      type: action.type,
      timestamp: new Date().toISOString(),
      params: action.params,
      tokens: action.tokens,
      duration: action.duration,
      status: action.status,
      accepted: action.accepted,
      model: action.model
    };

    // Mise à jour de la session
    this.currentSession.actions.push(sessionAction);
    this.currentSession.tokens.total.input += action.tokens.input;
    this.currentSession.tokens.total.output += action.tokens.output;
    this.currentSession.tokens.byModel[action.model] = (
      this.currentSession.tokens.byModel[action.model] || { input: 0, output: 0 }
    );
    this.currentSession.tokens.byModel[action.model].input += action.tokens.input;
    this.currentSession.tokens.byModel[action.model].output += action.tokens.output;

    // Mise à jour des stats globales
    this.updateGlobalStats(action);

    // Sauvegarde
    this.saveSession();
    this.saveStats();
  }

  trackConversation(message: ConversationMessage): void {
    this.currentSession.conversations.push({
      id: `conv-${Date.now()}`,
      messages: [message]
    });
    this.saveSession();
  }

  private updateGlobalStats(action: ActionMetadata): void {
    // Mise à jour des compteurs globaux
    this.stats.summary.totalTokens += action.tokens.total;
    this.stats.summary.totalActions++;
    
    // Mise à jour par modèle
    if (!this.stats.models[action.model]) {
      this.stats.models[action.model] = {
        tokensUsed: 0,
        sessions: 0,
        successRate: 0,
        avgResponseTime: 0,
        costEstimate: 0,
        categories: {}
      };
    }
    this.stats.models[action.model].tokensUsed += action.tokens.total;
    
    // Mise à jour par type d'action
    if (!this.stats.actions.byType[action.type]) {
      this.stats.actions.byType[action.type] = { count: 0, successRate: 0 };
    }
    this.stats.actions.byType[action.type].count++;
    
    // Recalcul des taux de succès
    this.recalculateSuccessRates();
  }

  private recalculateSuccessRates(): void {
    // Recalcul des taux de succès pour chaque modèle
    Object.keys(this.stats.models).forEach(model => {
      // Logique de recalcul
    });
    
    // Recalcul pour chaque type d'action
    Object.keys(this.stats.actions.byType).forEach(type => {
      // Logique de recalcul
    });
  }
}
```

**Export des Données** :
- **Format** : JSON, CSV
- **Période** : Tout l'historique, dernier mois, dernière semaine, aujourd'hui
- **Commande** : `Jarvis: Export Analytics`
- **Options** :
  - Inclure les conversations complètes
  - Inclure les détails des actions
  - Anonymiser les chemins de fichiers

**Réinitialisation** :
- **Réinitialisation complète** : Supprime toutes les données
- **Réinitialisation partielle** : Supprime seulement les données de session
- **Conservation** : Sauvegarde automatique avant réinitialisation

**Configuration de l'Analytics** :
```json
{
  "analytics": {
    "enabled": true,
    "tracking": {
      "tokens": true,
      "actions": true,
      "conversations": true,
      "performance": true,
      "errors": true
    },
    "storage": {
      "retentionDays": 90,
      "autoBackup": true,
      "backupFrequency": "daily"
    },
    "privacy": {
      "anonymizeFilePaths": false,
      "excludeContent": false
    },
    "budget": {
      "enabled": true,
      "monthlyLimit": 100.00,
      "warnAt": 80,
      "stopAt": 100
    }
  }
}
```

## 8. Stratégies d'Optimisation pour Petits Modèles (Local / Ollama)

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

### 8.1. Micro-Tâches (Task Decomposition)

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

**Implémentation du Task Decomposer** :
```typescript
class TaskDecomposer {
  private maxContextLength: number;
  private complexityThresholds: Record<string, number>;

  constructor(modelConfig: ModelConfig) {
    this.maxContextLength = modelConfig.contextLength;
    this.complexityThresholds = {
      'simple': 1000,      // 1 tâche
      'medium': 5000,      // 2-3 tâches
      'complex': 10000,    // 3-5 tâches
      'veryComplex': 30000 // 5-10 tâches
    };
  }

  decompose(task: string): Task[] {
    // 1. Analyser la complexité
    const complexity = this.analyzeComplexity(task);
    
    // 2. Déterminer le niveau de découpage
    const level = this.getDecompositionLevel(complexity);
    
    // 3. Découper selon le niveau
    switch (level) {
      case 'simple':
        return [{ ...task, id: `task-1`, dependencies: [] }];
      case 'medium':
        return this.decomposeMedium(task);
      case 'complex':
        return this.decomposeComplex(task);
      case 'veryComplex':
        return this.decomposeVeryComplex(task);
    }
  }

  private analyzeComplexity(task: string): number {
    // Calcul de la complexité basé sur :
    // - Nombre de mots
    // - Nombre de concepts techniques
    // - Présence de connecteurs logiques (et, ou, puis)
    // - Longueur estimée du code à générer
    const wordCount = task.split(/\s+/).length;
    const technicalTerms = this.countTechnicalTerms(task);
    const logicalConnectors = (task.match(/et|ou|puis|ensuite|après/gi) || []).length;
    
    return wordCount * 10 + technicalTerms * 50 + logicalConnectors * 100;
  }

  private decomposeComplex(task: string): Task[] {
    // Découpage en 3-5 tâches
    const steps = this.extractSteps(task);
    return steps.map((step, index) => ({
      id: `task-${index + 1}`,
      description: step,
      dependencies: index > 0 ? [`task-${index}`] : [],
      estimatedTokens: this.estimateTokens(step)
    }));
  }
}
```

**Avantages des Micro-Tâches** :
- **Meilleure qualité** : Le modèle se concentre sur une seule chose à la fois
- **Moins d'erreurs** : Réduction de la complexité cognitive
- **Meilleur contexte** : Chaque tâche peut avoir son propre contexte ciblé
- **Validation intermediate** : Possibilité de valider chaque étape
- **Reprise facile** : Si une tâche échoue, on peut repartir de là

**Exemple de Workflow avec Micro-Tâches** :
```typescript
async function executeWithMicroTasks(mainTask: string): Promise<ExecutionResult> {
  const decomposer = new TaskDecomposer(modelConfig);
  const tasks = decomposer.decompose(mainTask);
  
  const results: TaskResult[] = [];
  
  for (const task of tasks) {
    // 1. Préparer le contexte pour cette micro-tâche
    const context = await this.prepareContextForTask(task);
    
    // 2. Exécuter la micro-tâche
    const result = await this.executeTask(task, context);
    results.push(result);
    
    // 3. Valider le résultat
    if (!await this.validateResult(task, result)) {
      // 4. Corriger ou demander de l'aide
      const corrected = await this.handleFailure(task, result);
      if (!corrected) {
        return { success: false, completedTasks: results.length };
      }
    }
    
    // 5. Mettre à jour le contexte global
    this.updateGlobalContext(task, result);
  }
  
  return { success: true, results };
}
```

### 8.2. JSON Mode & Few-Shot Prompting

**JSON Mode** : Forcer le modèle à répondre dans un **format structuré et parseable**.

**Avantages** :
- **Parsing garanti** : Pas d'ambiguïté dans la réponse
- **Validation facile** : On peut valider la structure avant de traiter
- **Intégration simplifiée** : Les réponses peuvent être directement utilisées dans le code

**Template de Prompt JSON Mode** :
```text
Tu es un assistant de code qui répond UNIQUEMENT en JSON valide.

Règles :
1. Ta réponse DOIT être un JSON valide
2. Utilise uniquement les champs définis dans le schéma
3. Si tu ne peux pas répondre, retourne { "error": "description de l'erreur" }
4. Ne jamais inclure de texte en dehors du JSON

Schéma attendu :
{
  "type": "action", // ou "explanation", "error"
  "action": "write_file" | "edit_file" | "read_file" | "terminal" | "none",
  "params": {
    // Diffère selon l'action
  },
  "explanation": "Brève explication de l'action (max 100 caractères)",
  "confidence": 0.0 - 1.0 // Niveau de confiance dans la réponse
}

Exemples de schémas par action :

write_file:
{
  "action": "write_file",
  "params": {
    "path": "chemin/du/fichier.ext",
    "content": "contenu du fichier"
  }
}

edit_file:
{
  "action": "edit_file",
  "params": {
    "path": "chemin/du/fichier.ext",
    "start": { "line": 10, "character": 5 },
    "end": { "line": 10, "character": 15 },
    "newText": "nouveau texte"
  }
}

terminal:
{
  "action": "terminal",
  "params": {
    "command": "commande à exécuter",
    "cwd": "répertoire de travail"
  }
}

Maintenant, traitons la demande suivante :

Demande : {userRequest}

Réponds en JSON :
```

**Few-Shot Prompting** : Fournir des **exemples concrets** avant la demande réelle pour guider le modèle.

**Exemple de Few-Shot pour la génération de fonctions** :
```text
Voici des exemples de comment je veux que tu génères des fonctions :

Exemple 1:
Demande : "Crée une fonction qui additionne deux nombres"
Réponse :
```javascript
/**
 * Additionne deux nombres
 * @param {number} a - Premier nombre
 * @param {number} b - Deuxième nombre
 * @returns {number} La somme de a et b
 */
function add(a, b) {
  return a + b;
}
```

Exemple 2:
Demande : "Crée une fonction qui vérifie si un nombre est pair"
Réponse :
```javascript
/**
 * Vérifie si un nombre est pair
 * @param {number} num - Le nombre à vérifier
 * @returns {boolean} true si pair, false sinon
 */
function isEven(num) {
  return num % 2 === 0;
}
```

Exemple 3:
Demande : "Crée une fonction qui inverse une chaîne"
Réponse :
```javascript
/**
 * Inverse une chaîne de caractères
 * @param {string} str - La chaîne à inverser
 * @returns {string} La chaîne inversée
 */
function reverseString(str) {
  return str.split('').reverse().join('');
}
```

Maintenant, traite cette demande :
Demande : "Crée une fonction qui calcule la factorielle d'un nombre"
```

**Combinaison JSON Mode + Few-Shot** :
```text
Tu es un assistant qui génère du code.
Réponds UNIQUEMENT en JSON avec ce schéma :

{
  "type": "code_generation",
  "language": "string", // langage de programmation
  "code": "string", // code généré
  "description": "string", // description du code
  "examples": [
    {
      "input": "string", // entrée d'exemple
      "output": "string" // sortie attendue
    }
  ],
  "complexity": "low" | "medium" | "high"
}

Voici des exemples de réponses valides :

Exemple 1 - Fonction simple :
{
  "type": "code_generation",
  "language": "javascript",
  "code": "function add(a, b) { return a + b; }",
  "description": "Fonction d'addition de deux nombres",
  "examples": [
    { "input": "add(2, 3)", "output": "5" },
    { "input": "add(-1, 1)", "output": "0" }
  ],
  "complexity": "low"
}

Exemple 2 - Fonction avec logique :
{
  "type": "code_generation",
  "language": "python",
  "code": "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)",
  "description": "Fonction récursive de calcul de factorielle",
  "examples": [
    { "input": "factorial(5)", "output": "120" },
    { "input": "factorial(0)", "output": "1" }
  ],
  "complexity": "medium"
}

Maintenant, génère le code pour cette demande :
Demande : "Crée une fonction qui vérifie si une chaîne est un palindrome"
```

**Validation des Réponses JSON (Version 2.1 - Avec Nettoyeur Robuste)** :

**⚠️ Problème identifié** : Les modèles locaux (Qwen 2.5 7B) ne respectent pas toujours parfaitement le format JSON.

**✅ Solution** : Nettoyeur multi-étapes intégré :

```typescript
// 🔧 Helper : Extraire le JSON d'une string potentiellement mal formatée
function extractJsonFromString(input: string): string | null {
  // 1. Trouver la première accolade ouvrante
  const firstBrace = input.indexOf('{');
  if (firstBrace === -1) return null;
  
  // 2. Trouver la dernière accolade fermante
  const lastBrace = input.lastIndexOf('}');
  if (lastBrace === -1) return null;
  
  // 3. Extraire le contenu entre les accolades
  let jsonString = input.substring(firstBrace, lastBrace + 1);
  
  // 4. Nettoyer les artefacts courants
  jsonString = jsonString
    .replace(/^```(json)?\s*/i, '')      // Enlever les code blocks Markdown
    .replace(/\s*```$/i, '')            // Enlever les code blocks fin
    .replace(/^json\s*:?\s*/i, '')      // Enlever les préfixes "json:"
    .replace(/^\s*[\[\]{}]+\s*/, '')   // Enlever les accolades isolées
    .trim();
  
  return jsonString;
}

// 🔧 Helper : Corriger les erreurs JSON courantes
function fixCommonJsonErrors(json: string): string {
  let fixed = json;
  
  // 1. Corriger les accolades non fermées
  const openBraces = (fixed.match(/\{/g) || []).length;
  const closeBraces = (fixed.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    fixed += '}'.repeat(openBraces - closeBraces);
  }
  
  // 2. Corriger les crochets non fermés
  const openBrackets = (fixed.match(/\[/g) || []).length;
  const closeBrackets = (fixed.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    fixed += ']'.repeat(openBrackets - closeBrackets);
  }
  
  // 3. Ajouter des virgules manquantes entre propriétés
  fixed = fixed.replace(/:\s*([a-zA-Z0-9_"']+)\s*:/g, ',\n$1:');
  
  // 4. Guillemets manquants sur les clés (attention aux falses positives)
  fixed = fixed.replace(/
/g, ' ').replace(/\s+([a-zA-Z0-9_]+)\s*:/g, ' "$1":');
  
  // 5. Valeurs string non quotes (simpliste - à améliorer)
  fixed = fixed.replace(/:\s*([a-zA-Z0-9_\-./]+)\s*(?:,|\}|\]|$)/g, ': "$1"$2');
  
  return fixed;
}

// ✅ Fonction principale avec nettoyeur intégré
function validateJsonResponse(response: string): ValidationResult {
  let parsed: any;
  let cleaned = false;
  let fixed = false;
  
  try {
    // 1. Essayer de parser directement
    parsed = JSON.parse(response);
  } catch (error) {
    // 2. Si échec, extraire le JSON du string
    const extractedJson = extractJsonFromString(response);
    if (extractedJson) {
      try {
        parsed = JSON.parse(extractedJson);
        cleaned = true;
      } catch (innerError) {
        // 3. Dernière tentative : corriger les erreurs courantes
        const fixedJson = fixCommonJsonErrors(extractedJson);
        if (fixedJson && fixedJson !== extractedJson) {
          try {
            parsed = JSON.parse(fixedJson);
            cleaned = true;
            fixed = true;
          } catch {
            // Rien ne fonctionne
          }
        }
      }
    }
    
    // Si toujours pas de parsing, retourner l'erreur
    if (!parsed) {
      return { 
        valid: false, 
        error: `JSON invalide : ${error.message}`,
        rawResponse: response,
        suggestion: extractedJson ? "Le JSON semble partiel ou mal formaté" : null
      };
    }
  }
  
  // Vérification du schéma
  if (!parsed.type || !parsed.action) {
    return { 
      valid: false, 
      error: "Champs manquants : type, action",
      cleaned,
      fixed
    };
  }
  
  // Vérification selon le type
  switch (parsed.type) {
    case 'action':
      if (!['write_file', 'edit_file', 'read_file', 'terminal', 'none'].includes(parsed.action)) {
        return { valid: false, error: `Action invalide : ${parsed.action}`, cleaned, fixed };
      }
      if (parsed.action !== 'none' && !parsed.params) {
        return { valid: false, error: "params manquant pour l'action", cleaned, fixed };
      }
      break;
    case 'explanation':
      if (!parsed.explanation) {
        return { valid: false, error: "explanation manquant", cleaned, fixed };
      }
      break;
    case 'error':
      if (!parsed.error) {
        return { valid: false, error: "error manquant", cleaned, fixed };
      }
      break;
    default:
      return { valid: false, error: `Type invalide : ${parsed.type}`, cleaned, fixed };
  }
  
  return { 
    valid: true, 
    data: parsed,
    cleaned,   // true si nettoyage a été nécessaire
    fixed      // true si correction a été appliquée
  };
}

// Interface étendue
interface ValidationResult {
  valid: boolean;
  data?: any;
  error?: string;
  rawResponse?: string;
  cleaned?: boolean;
  fixed?: boolean;
  suggestion?: string | null;
}
```

**Amélioration du Template JSON Mode (Version 2.1)** :

```text
Règles STRICTES pour le format JSON :
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Ta réponse DOIT commencer par { et se terminer par }
2. NE JAMAIS inclure de texte avant { ou après }
3. NE JAMAIS utiliser de code blocks (```json ... ```)
4. NE JAMAIS inclure d'explications, commentaires ou préfixes
5. NE JAMAIS omettre de fermer les accolades et guillemets

Exemples VALIDES :
{"type":"action","action":"write_file","params":{"path":"test.js"}}
{"type":"explanation","explanation":"La fonction est correcte"}

Exemples INVALIDES (À ÉVITER ABSOLUMENT) :
❌ Voici ma réponse : {"type":"action"}          (texte avant)
❌ {"type":"action"} # Commentaire              (commentaire)
❌ ```json                                       (code block)
   {"type":"action"}
   ```
❌ {"type":"action"                            (accolade non fermée)

Maintenant, réponds UNIQUEMENT avec le JSON (RIEN D'AUTRE) :
```

**Test de robustesse** :
```typescript
// Ces réponses seront toutes correctement parsées :
const testCases = [
  '{"type":"action","action":"write_file"}',                              // ✅ Parfait
  'Voici : {"type":"action","action":"write_file"}',                      // ✅ Nettoyé
  '```json\n{"type":"action"}\n```',                                         // ✅ Code blocks enlevés
  'json: {"type":"action"}',                                                  // ✅ Préfixe enlevé
  '{"type":"action", "action":"write_file"',                               // ✅ Accolades fermées
  '{"type":"action","action":"write_file"'                                // ✅ Accolade ajoutée
];
```

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

**Implémentation du Context Pruner** :
```typescript
class ContextPruner {
  private parser: TreeSitter;
  private workspace: Workspace;

  async prune(filePath: string, cursorPosition: Position, strategy: PruningStrategy): Promise<PrunedContext> {
    // 1. Lire le fichier
    const content = await this.workspace.readFile(filePath);
    
    // 2. Parser avec Tree-sitter
    const tree = this.parser.parse(content);
    
    // 3. Trouver le nœud à la position du curseur
    const node = tree.rootNode.namedDescendantForPosition(cursorPosition);
    
    // 4. Extraire selon la stratégie
    switch (strategy) {
      case 'function':
        return this.extractFunctionContext(node, tree, content);
      case 'class':
        return this.extractClassContext(node, tree, content);
      case 'module':
        return this.extractModuleContext(tree, content);
      case 'project':
        return this.extractProjectContext(filePath, node);
      default:
        return { content, tokens: this.countTokens(content) };
    }
  }

  private extractFunctionContext(node: SyntaxNode, tree: Tree, content: string): PrunedContext {
    // Trouver la fonction parente
    const functionNode = this.findParentOfType(node, 'function_declaration') ||
                         this.findParentOfType(node, 'method_definition') ||
                         this.findParentOfType(node, 'arrow_function');
    
    if (!functionNode) {
      return { content, tokens: this.countTokens(content) };
    }
    
    // Extraire la fonction
    const functionText = content.substring(functionNode.startIndex, functionNode.endIndex);
    
    // Extraire les imports utilisés dans la fonction
    const imports = this.extractUsedImports(tree, functionNode, content);
    
    // Extraire les types utilisés
    const types = this.extractUsedTypes(tree, functionNode, content);
    
    // Extraire les fonctions appelées
    const calledFunctions = this.extractCalledFunctions(tree, functionNode, content);
    
    // Construire le contexte
    const prunedContent = `
// === Contexte pour ${functionNode.type} === //

// Imports utilisés :
${imports.join('\n')}

// Types utilisés :
${types.join('\n')}

// Fonctions appelées :
${calledFunctions.map(f => `// ${f.name}: ${f.signature}`).join('\n')}

// Fonction actuelle :
${functionText}
    `;
    
    return {
      content: prunedContent,
      tokens: this.countTokens(prunedContent),
      metadata: {
        type: 'function',
        functionName: this.getFunctionName(functionNode, content),
        startLine: functionNode.startPosition.row + 1,
        endLine: functionNode.endPosition.row + 1
      }
    };
  }

  private extractUsedImports(tree: Tree, functionNode: SyntaxNode, content: string): string[] {
    // Logique pour extraire les imports utilisés dans la fonction
    const imports: string[] = [];
    const importNodes = tree.rootNode.descendantsOfType('import_statement');
    
    // Analyser les identifiants utilisés dans la fonction
    const usedIdentifiers = this.extractIdentifiers(functionNode);
    
    // Trouver les imports qui correspondent
    importNodes.forEach(importNode => {
      const importText = content.substring(importNode.startIndex, importNode.endIndex);
      const importedNames = this.extractImportedNames(importNode, content);
      
      if (importedNames.some(name => usedIdentifiers.includes(name))) {
        imports.push(importText);
      }
    });
    
    return imports;
  }
}
```

**Exemple de Context Pruning** :
```typescript
// Fichier original (500 lines, 20K tokens)
// src/services/userService.ts

import { UserModel } from '../models/user';
import { Database } from '../database';
import { Logger } from '../utils/logger';
import { validateEmail } from '../utils/validation';
import { sendEmail } from '../services/email';
import { cache } from '../utils/cache';

// ... 400 autres lignes de code

class UserService {
  // ... autres méthodes
  
  async updateUserEmail(userId: string, newEmail: string): Promise<UserModel> {
    // Vérifier que l'email est valide
    if (!validateEmail(newEmail)) {
      throw new Error('Email invalide');
    }
    
    // Vérifier que l'email n'est pas déjà utilisé
    const existingUser = await Database.getUserByEmail(newEmail);
    if (existingUser) {
      throw new Error('Email déjà utilisé');
    }
    
    // Mettre à jour l'email
    const updatedUser = await Database.updateUser(userId, { email: newEmail });
    
    // Envoyer un email de confirmation
    await sendEmail(updatedUser.email, 'Email mis à jour', 'Votre email a été mis à jour');
    
    // Logger
    Logger.info(`Email mis à jour pour l'utilisateur ${userId}`);
    
    return updatedUser;
  }
  
  // ... autres méthodes
}

// Avec Context Pruning (strategy: 'function') - ~200 tokens
// === Contexte pour method_definition === //

// Imports utilisés :
import { UserModel } from '../models/user';
import { Database } from '../database';
import { validateEmail } from '../utils/validation';
import { sendEmail } from '../services/email';

// Fonctions appelées :
// validateEmail: (email: string) => boolean
// Database.getUserByEmail: (email: string) => Promise<UserModel | null>
// Database.updateUser: (id: string, data: Partial<UserModel>) => Promise<UserModel>
// sendEmail: (to: string, subject: string, body: string) => Promise<void>

// Fonction actuelle :
async updateUserEmail(userId: string, newEmail: string): Promise<UserModel> {
  // Vérifier que l'email est valide
  if (!validateEmail(newEmail)) {
    throw new Error('Email invalide');
  }
  
  // Vérifier que l'email n'est pas déjà utilisé
  const existingUser = await Database.getUserByEmail(newEmail);
  if (existingUser) {
    throw new Error('Email déjà utilisé');
  }
  
  // Mettre à jour l'email
  const updatedUser = await Database.updateUser(userId, { email: newEmail });
  
  // Envoyer un email de confirmation
  await sendEmail(updatedUser.email, 'Email mis à jour', 'Votre email a été mis à jour');
  
  return updatedUser;
}
```

**Sélection Automatique de la Stratégie** :
```typescript
function selectPruningStrategy(nodeType: string, modelContextLength: number): PruningStrategy {
  const strategyMap: Record<string, PruningStrategy> = {
    'function_declaration': 'function',
    'method_definition': 'function',
    'arrow_function': 'function',
    'class_declaration': 'class',
    'variable_declaration': 'function', // Variable dans une fonction
    '': 'module' // Par défaut
  };
  
  // Si le modèle a beaucoup de contexte, on peut être plus généreux
  if (modelContextLength > 100000) {
    // Moins de pruning pour les grands modèles
    const baseStrategy = strategyMap[nodeType] || 'module';
    return this.getMoreInclusiveStrategy(baseStrategy);
  } else {
    // Plus de pruning pour les petits modèles
    return strategyMap[nodeType] || 'function';
  }
}
```

**Intégration avec le Token Counter** :
```typescript
class OptimizedContextProvider {
  private pruner: ContextPruner;
  private counter: TokenCounter;

  async getOptimizedContext(filePath: string, cursorPosition: Position): Promise<ContextResult> {
    // 1. Essayer avec la stratégie la plus restrictive
    const strategies: PruningStrategy[] = ['function', 'class', 'module', 'project', 'none'];
    
    for (const strategy of strategies) {
      const pruned = await this.pruner.prune(filePath, cursorPosition, strategy);
      
      // 2. Vérifier si le contexte est suffisant
      const estimatedTokens = this.counter.estimateTokensForResponse(pruned.tokens);
      
      if (estimatedTokens < this.counter.getRemainingTokens() * 0.8) {
        // 80% de marge pour la réponse
        return {
          context: pruned.content,
          strategy,
          tokensUsed: pruned.tokens,
          metadata: pruned.metadata
        };
      }
    }
    
    // 3. Si aucune stratégie ne fonctionne, utiliser le fichier complet
    return {
      context: await this.workspace.readFile(filePath),
      strategy: 'none',
      tokensUsed: this.counter.countTokens(await this.workspace.readFile(filePath)),
      metadata: { type: 'full_file' }
    };
  }
}
```

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

**Estimation** : **2-3 semaines**

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

**Estimation** : **3-4 semaines**

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

**Estimation** : **2-3 semaines**

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

**Estimation** : **2-3 semaines**

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

**Estimation** : **3-4 semaines**

---

### 9.6. Timeline Global (Version 2.1 - Réaliste)

**⚠️ Révision basée sur le retour d'expérience** : Timeline ajustée pour refléter la complexité réelle de l'API VS Code.

**Nouvelle Timeline avec Scope MVP Réduit** :

```
Q3 2026 (Juillet - Septembre)
├── Juillet (4 semaines) - MVP COMPLET
│   ├── Semaine 1: Phase 1 - Setup & Fondations
│   │   ├── Boilerplate VS Code Extension
│   │   ├── Svelte + Vite + Tailwind (UN SEUL langage: TypeScript)
│   │   ├── Token Jauge
│   │   └── .jarvisignore
│   │
│   ├── Semaine 2: Fin Phase 1 + Début Phase 2
│   │   ├── Configuration Ollama (UN SEUL provider)
│   │   ├── Streaming de base
│   │   ├── Chat Panel
│   │   └── Début Sandboxing (validation paths)
│   │
│   ├── Semaine 3: Suite Phase 2 - Sécurité Basique
│   │   ├── Terminal avec HITL
│   │   ├── Lecture/Écriture fichiers
│   │   ├── Scrubbing (patterns principaux)
│   │   └── Time Travel (git stash SEULEMENT)
│   │
│   └── Semaine 4: Finalisation MVP
│       ├── Tests de base
│       ├── Documentation
│       └── Package VSIX
│
├── Août (4 semaines) - Fonctionnalités Intermédiaires
│   ├── Semaine 1: Phase 3 - Agentic Basique
│   │   ├── Auto-TDD Loop (basique)
│   │   ├── Tools personnalisés
│   │   └── Agents spécialisés (@Coder-Agent)
│   │
│   ├── Semaine 2: Suite Phase 3 + Début Phase 4
│   │   ├── Workflows simples
│   │   ├── Analytics de base
│   │   └── @file / @docs
│   │
│   ├── Semaine 3: Phase 4 - Analytics & Context
│   │   ├── Dashboard complet
│   │   ├── Tracking tokens
│   │   └── RAG basique (Vectra)
│   │
│   └── Semaine 4: Début Phase 5
│       ├── Context Pruning (basique)
│       └── Micro-Tâches (automatique)
│
└── Septembre (4 semaines) - Fonctionnalités Avancées
    ├── Semaine 1-2: Suite Phase 5
    │   ├── Tree-sitter (TypeScript + JavaScript)
    │   ├── Context Pruning avancé
    │   └── Système de plugins
    │
    ├── Semaine 3: Tests & Stabilisation
    │   ├── Tests unitaires (>80% coverage)
    │   ├── Tests d'intégration
    │   └── Documentation complète
    │
    └── Semaine 4: Préparation Release v1.0
        ├── Bêta privée
        ├── Corrections de bugs
        └── Package final

Q4 2026 (Octobre - Décembre)
├── Octobre: Bêta publique + Collecte de feedbacks
│   ├── Deployment sur VS Code Marketplace (Preview)
│   ├── Documentation utilisateur
│   └── Tutoriels vidéo
│
├── Novembre: Améliorations basées sur feedbacks
│   ├── Ajout des providers Cloud (OpenRouter, Mistral)
│   ├── Support multi-langages Tree-sitter
│   └── Time Travel avec git tags
│
└── Décembre: Version 1.0 Stable
    ├── Release officielle
    ├── Annonce publique
    └── Roadmap v2.0
```

**Règle d'Or MVP** 🏆 :
> "**Un langage, un provider, une fonctionnalité à la fois**"
> — Maxime (03/07/2026)

**Scope MVP (Juillet - MVP Complet)** :
- ✅ **1 Provider** : Ollama (OpenRouter en option désactivée par défaut)
- ✅ **1 Langage** : TypeScript (Tree-sitter)
- ✅ **Fonctionnalités Core** : Chat, Token Jauge, lecture/écriture, terminal
- ✅ **Sécurité Basique** : Sandboxing (paths), Scrubbing (patterns principaux), HITL (modéré)
- ✅ **Time Travel** : git stash seulement (pas de tags)
- ❌ **Reporté** : Multi-providers, Multi-langages, RAG avancé, Analytics complet

**Justification** :
- Focus sur la **stabilité** et la **qualité**
- Éviter la **dette technique** dès le départ
- Permettre une **release rapide** avec un produit utilisable
- **Itération** sur les fonctionnalités avancées ensuite

### 9.7. Priorités et Décisions d'Architecture

**Priorités Absolues** (Doit être fait avant toute release) :
1. **Sécurité** : Sandboxing, HITL, Scrubbing
2. **Stabilité** : Pas de crash, pas de perte de données
3. **UX Basique** : Interface intuitive et réactive
4. **Fonctionnalités Core** : Chat, Token Jauge, lecture/écriture

**Priorités Élevées** (Important pour la première release) :
1. Auto-TDD Loop
2. Time Travel (Checkpoints)
3. Dashboard Analytics
4. Configuration des modèles

**Priorités Moyennes** (Peut attendre la v1.1 ou v1.2) :
1. RAG Local
2. Context Pruning AST
3. Système de plugins
4. Micro-Tâches automatiques

**Décisions d'Architecture Clés (Version 2.1)** :

| Décision | Choix | Raison | Statut |
|----------|-------|--------|--------|
| **Framework Frontend** | Svelte 4.x | Léger, réactif, facile à intégrer avec VS Code | ✅ Validé |
| **Bundler** | Vite 5.x | Build rapide, HMR, bonne intégration | ✅ Validé |
| **Styling** | Tailwind CSS 4.x | Thématique native VS Code facile | ✅ Validé |
| **Backend** | Node.js 20.x LTS | Standard pour les extensions VS Code | ✅ Validé |
| **MCP** | Version 1.0+ | Standard émergent, futur-proof | ✅ Validé |
| **Tree-sitter** | web-tree-sitter | Version WASM, **100% JS**, fonctionne dans le browser | ✅ **Mise à jour 2.1** |
| **Embeddings** | @xenova/transformers | **WASM**, léger, compatible browser, **remplace @tensorflow/tfjs** | ✅ **Nouveau 2.1** |
| **RAG** | Vectra | Léger, facile à intégrer, local | ✅ Validé |
| **Storage** | JSON local | Simple, pas de dépendance externe | ✅ Validé |
| **Scope MVP** | 1 langage, 1 provider | Focus sur stabilité et qualité | ✅ **Nouvelle stratégie 2.1** |

**Justification des Choix Techniques 2.1** :

1. **@xenova/transformers vs @tensorflow/tfjs** :
   - ❌ `@tensorflow/tfjs` : Lourd (~10MB), dépendances complexes, problèmes de build
   - ✅ `@xenova/transformers` : Léger (~2MB), WASM pur, zero-dependency, **100% compatible Electron**

2. **web-tree-sitter vs tree-sitter natif** :
   - ❌ `tree-sitter` natif : Nécessite compilation C++, incompatible avec Vite
   - ✅ `web-tree-sitter` : WASM pré-compilé, **intégration seamless** avec Vite

3. **Scope MVP Réduit** :
   - ❌ "Tout faire en même temps" : Risque élevé de dette technique, délais imprévisibles
   - ✅ "Un langage, un provider à la fois" : **Release rapide**, qualité garantie, itération possible

### 9.8. Risque et Mitigation

**Matrice des Risques** :

| Risque | Probabilité | Impact | Stratégie de Mitigation |
|--------|-------------|--------|------------------------|
| **Complexité MCP** | Moyenne | Élevé | Commencer avec une implémentation basique, puis étendre |
| **Performances Tree-sitter** | Faible | Élevé | Utiliser web-tree-sitter (wasm), cache des résultats |
| **Limites des petits modèles** | Élevée | Moyen | Micro-Tâches + Context Pruning |
| **Sécurité (Sandboxing)** | Faible | Critique | Tests exhaustifs, audit de code |
| **Compatibilité VS Code** | Moyenne | Élevé | Tester avec plusieurs versions de VS Code |
| **Adoption utilisateurs** | Inconnue | Moyen | Documentation complète, exemples, templates |
| **Maintenance** | Élevée | Moyen | Modularité, bonnes pratiques, tests automatiques |
| **Évolution de l'API MCP** | Faible | Moyen | Abstraction via interfaces, adaptation rapide |

**Stratégies de Réduction des Risques** :
1. **Développement incrémental** : Livrer des fonctionnalités une par une
2. **Tests automatiques** : Couverture de test > 80%
3. **Revues de code** : Chaque PR est revu par au moins un autre développeur
4. **Documentation** : Documentation complète à chaque étape
5. **Feedback utilisateurs** : Impliquer les early adopters rapidement
6. **Backup automatique** : Sauvegarde des configurations et données
7. **Rollback facile** : Possibilité de revenir en arrière à tout moment

---

## 10. Feedback & Révision V2.0

### 🌟 État de la V2.0

Cette Version 2.0 est tout simplement **exceptionnelle**. Le projet est passé d'une simple liste d'idées à un véritable document d'architecture logicielle (Architecture Decision Record / PRD) prêt pour la production.

Le niveau de détail technique montre une excellente compréhension des défis inhérents aux LLMs et au développement d'outils agentiques.

### 🏆 Ce qui rend cette V2 brillante

#### 1. L'architecture orientée "Data" et Benchmarking (Section 7)

C'est sans doute la plus grande force de ce document. La mise en place de métriques précises (taux de succès, tokens/action, temps moyen) et d'un dashboard de télémétrie locale apporte une **rigueur scientifique indispensable**. 

C'est exactement le type d'approche analytique nécessaire pour évaluer et benchmarker sérieusement des modèles IA lors de déploiements d'outils internes. Le projet transforme une simple extension en un véritable **environnement d'analyse de données appliquées au code**.

**Impact** : Permet de mesurer l'efficacité réelle et d'optimiser continuellement le système.

#### 2. La gestion chirurgicale des petits modèles (Section 8)

L'implémentation du `TaskDecomposer` pour créer des micro-tâches et l'utilisation de l'AST (Tree-sitter) pour le *Context Pruning* montrent que vous avez parfaitement cerné les **limites des modèles de 7B-14B paramètres**. 

Le code d'exemple avec `selectPruningStrategy` est particulièrement élégant. Cette approche garantit que même les modèles locaux les moins puissants peuvent accomplir des tâches complexes avec une fiabilité élevée.

**Impact** : Démocratise l'utilisation des LLMs locaux sans sacrifier la qualité.

#### 3. La sécurité "By Design" (Section 6)

L'approche systémique avec le `SandboxManager`, l'auto-génération du `.jarvisignore` et le *Scrubber* pour éviter la fuite de secrets avec des regex précises **garantit que l'outil pourrait passer un audit de sécurité informatique strict**.

Les trois niveaux HITL (Strict, Modéré, Libre) offrent un équilibre idéal entre contrôle et productivité.

**Impact** : Entreprises et institutions critiques pourront adopter l'outil en confiance.

#### 4. Les structures de données claires

La définition exhaustive des schémas JSON pour les configurations, les agents (`jarvis-agents/`), et les workflows rend le système **hautement modulaire** et extensible.

**Impact** : Écosystème prêt pour l'open-source et les contributions communautaires.

---

### ⚠️ Points de vigilance (Le regard de l'ingénieur)

Pour que ce projet se déroule sans accroc, voici trois **défis techniques réels** que vous allez rencontrer lors de l'implémentation de ce cahier des charges :

#### 1. Le piège des dépendances natives (Tree-sitter & Vectra)

**Problème** : Dans l'environnement VS Code (qui tourne sous Electron/Node.js), l'intégration de modules utilisant du C++ ou du Rust compilé (comme souvent avec les bases vectorielles ou le parsing natif) peut être un **cauchemar lors du "build" avec Vite**.

Les versions natives peuvent :
- Causer des conflits de compilation
- Augmenter considérablement la taille du bundle
- Créer des problèmes de compatibilité cross-platform (Windows/Mac/Linux)

**Solution** : 
- ✅ Votre choix de `web-tree-sitter` (version WebAssembly) est **excellent** pour contourner cela.
- ✅ Assurez-vous de faire de même pour les embeddings (ex: `@xenova/transformers`) pour rester **100% en JavaScript/WASM**.
- ✅ Pour Vectra, préférez les implémentations pures JavaScript ou validez que la version compilée fonctionne en Electron avant d'avancer.

**Recommandations** :
```json
{
  "dependencies": {
    "web-tree-sitter": "^0.20.0",     // ✅ WASM
    "@xenova/transformers": "^2.0.0", // ✅ WASM pour embeddings
    "vectra": "^0.1.0"                // ⚠️ Vérifier compilabilité
  },
  "devDependencies": {
    "esbuild": "^0.19.0",             // Pour bundles optimisés
    "@vscode/vsce": "^3.0.0"          // Pour packaging
  }
}
```

#### 2. L'illusion du JSON Mode à 100%

**Problème** : Même avec un excellent prompt "Few-Shot", les modèles locaux (comme Qwen 2.5 7B) **oublieront parfois de fermer une accolade** ou rajouteront du texte Markdown (`json ...`) autour de la réponse.

**Situations rencontrées** :
- Réponse : `json\n{...incomplete...\n`
- Réponse : `{...}extra markdown text`
- Réponse : `{"data": {...` (accolade non fermée)

**Solution** :
Prévoyez dans votre `validateJsonResponse` un **petit nettoyeur (regex)** qui extrait automatiquement ce qui se trouve entre la **première `{` et la dernière `}`** avant de lancer le `JSON.parse()`.

**Code recommandé** :
```typescript
function extractAndValidateJson(response: string): ValidationResult {
  try {
    // Nettoyer la réponse
    const cleaned = response.trim();
    
    // Extraire entre les premières { et }
    const jsonMatch = cleaned.match(/\{[\s\S]*\}(?=\s*(?:```|$))/);
    if (!jsonMatch) {
      // Fallback: chercher simplement { ... }
      const fallback = cleaned.match(/\{[\s\S]*\}/);
      if (!fallback) {
        return { valid: false, error: 'Aucune structure JSON trouvée' };
      }
      return validateJsonResponse(fallback[0]);
    }
    
    const jsonStr = jsonMatch[0];
    const parsed = JSON.parse(jsonStr);
    return { valid: true, data: parsed };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}
```

#### 3. La Timeline très ambitieuse (Section 9.6)

**Problème** : Le planning prévoit de **boucler la Phase 1 et 2 en un mois**. La gestion du Terminal et du Sandboxing (Phase 2) **prend souvent plus de temps que prévu** en raison de la complexité de l'API VS Code.

Les pièges courants :
- L'intégration du terminal dans Electron est plus complexe qu'il n'y paraît
- Le capture de stdout/stderr en temps réel pose des problèmes de buffering
- Les droits d'accès aux fichiers sur Windows/Mac/Linux diffèrent
- Les tests sur plusieurs OS prennent du temps

**Solution** :
**Soyez impitoyable sur le scope du MVP**. Ne cherchez pas à gérer 15 langages avec Tree-sitter au début ; commencez par **rendre le pipeline parfait sur un seul langage** (ex: Python ou TypeScript).

**Recommandations d'ajustement du timeline** :

| Phase | Estimation Originale | Estimation Réaliste | Justification |
|-------|---------------------|---------------------|---------------|
| Phase 1 | 2-3 semaines | 3-4 semaines | Vite + Svelte = setup OK, mais il faut tester la build |
| Phase 2 | 3-4 semaines | 4-5 semaines | Terminal + Sandboxing = complexe, tests OS |
| Phase 3 | 2-3 semaines | 2-3 semaines | Auto-TDD = reposant sur Phase 2 |
| Phase 4 | 2-3 semaines | 2-3 semaines | Analytics = straightforward |
| Phase 5 | 3-4 semaines | 4-6 semaines | Tree-sitter + RAG = complexe + perf tests |
| **TOTAL** | **12-17 semaines** | **15-21 semaines** | **4-5 mois au lieu de 3** |

**Stratégie pour tenir le timeline** :
1. **Phase 1** : Limiter initialement à `read_file` et `write_file` simples (pas `edit_file`)
2. **Phase 2** : Terminal basique d'abord (commandes simples), puis ajouter la capture complexe
3. **Phase 3** : TDD pour 1 seul test framework au départ (Jest), puis Mocha/Vitest
4. **Phase 4** : Analytics avec JSON simple, graphiques basiques avant Chart.js
5. **Phase 5** : Context Pruning pour 1 langage (Python), puis généraliser

---

### 📊 Bilan

Ce document est une **feuille de route digne d'un ingénieur logiciel senior**. 

Si vous implémentez ne serait-ce que **70% de ces spécifications**, vous aurez construit l'une des extensions open-source les plus avancées du marché.

**Étapes pour les 30 prochains jours** :
1. Initialiser le projet via `yo code` (générateur officiel VS Code)
2. Configurer Svelte + Vite pour les webviews
3. Tester la build et le packaging avec `vsce`
4. Mettre en place les outils MCP de base
5. Créer la première version du Chat Panel
6. Implémenter le Token Counter

**Question suivante** : Par quelle étape technique concrète souhaitez-vous démarrer aujourd'hui : la génération du projet de base via `yo code`, ou la configuration du pipeline Svelte + Vite pour l'interface ?

---

## 11. Annexes

### 11.1. Structure Complète du Projet

```
Extension VS Code Jarvis/
├── .vscode/                          # Configuration VS Code
│   ├── launch.json                   # Configuration de debug
│   ├── tasks.json                    # Tasks pour le build
│   └── extensions.json               # Extensions recommandées
│
├── src/
│   ├── backend/                      # Backend (Node.js)
│   │   ├── core/
│   │   │   ├── mcp/
│   │   │   │   ├── client.ts         # Client MCP principal
│   │   │   │   ├── tools/
│   │   │   │   │   ├── fileSystem.ts # Outils système de fichiers
│   │   │   │   │   ├── terminal.ts   # Outil terminal
│   │   │   │   │   ├── webSearch.ts  # Outil de recherche web
│   │   │   │   │   └── git.ts        # Outils Git
│   │   │   │   └── index.ts          # Export des outils
│   │   │   ├── models/
│   │   │   │   ├── providers/
│   │   │   │   │   ├── abstract.ts   # Interface IModelProvider
│   │   │   │   │   ├── ollama.ts     # Provider Ollama
│   │   │   │   │   ├── openrouter.ts # Provider OpenRouter
│   │   │   │   │   └── mistral.ts    # Provider Mistral API
│   │   │   │   ├── config.ts         # Configuration des modèles
│   │   │   │   └── index.ts          # Export des providers
│   │   │   ├── streaming/
│   │   │   │   ├── tokenCounter.ts   # Compteur de tokens
│   │   │   │   └── streamHandler.ts  # Gestion des streams
│   │   │   └── utils/
│   │   │       ├── sandbox.ts       # Gestion du sandboxing
│   │   │       ├── scrubber.ts       # Filtrage des secrets
│   │   │       └── logger.ts         # Journalisation
│   │   │
│   │   ├── services/
│   │   │   ├── autoTDD.ts           # Boucle Auto-TDD
│   │   │   ├── hitl.ts              # Human-in-the-Loop
│   │   │   ├── checkpoint.ts        # Time Travel (Checkpoints)
│   │   │   ├── analytics.ts         # Collecte des métriques
│   │   │   ├── contextPruner.ts     # Context Pruning
│   │   │   └── taskDecomposer.ts    # Découpage en micro-tâches
│   │   │
│   │   ├── types/
│   │   │   ├── mcp.ts               # Types MCP
│   │   │   ├── models.ts            # Types des modèles
│   │   │   ├── actions.ts           # Types des actions
│   │   │   └── index.ts             # Export des types
│   │   │
│   │   └── extension.ts             # Point d'entrée principal
│   │
│   ├── frontend/                     # Frontend (Svelte)
│   │   ├── components/
│   │   │   ├── ChatPanel.svelte     # Panneau de chat principal
│   │   │   ├── TokenGauge.svelte    # Indicateur de tokens
│   │   │   ├── Sidebar.svelte       # Barre latérale
│   │   │   ├── ThinkingBlock.svelte # Affichage de la chaîne de pensée
│   │   │   ├── Message.svelte       # Composant de message
│   │   │   └── Dashboard/
│   │   │       ├── Analytics.svelte # Dashboard principal
│   │   │       ├── TokenStats.svelte # Stats des tokens
│   │   │       ├── Performance.svelte # Métriques de performance
│   │   │       └── History.svelte   # Historique des actions
│   │   │
│   │   ├── lib/
│   │   │   ├── theme.css            # Variables CSS VS Code
│   │   │   ├── markdown.ts          # Traitement du Markdown
│   │   │   └── utils.ts             # Fonctions utilitaires
│   │   │
│   │   ├── stores/
│   │   │   ├── chatStore.ts         # State du chat
│   │   │   ├── configStore.ts       # State de la config
│   │   │   └── uiStore.ts           # State de l'UI
│   │   │
│   │   └── App.svelte               # Application principale
│   │
│   ├── shared/                      # Code partagé
│   │   ├── constants.ts             # Constantes globales
│   │   ├── types.ts                # Types partagés
│   │   └── utils.ts                # Utilitaires partagés
│   │
│   └── test/                       # Tests
│       ├── backend/
│       │   ├── mcp.test.ts          # Tests MCP
│       │   ├── models.test.ts       # Tests des modèles
│       │   ├── sandbox.test.ts      # Tests de sandboxing
│       │   └── scrubber.test.ts     # Tests de scrubbing
│       └── frontend/
│           └── components.test.ts   # Tests des composants
│
├── jarvis/                         # Fichiers de configuration Jarvis
│   ├── jarvis-config.json           # Configuration principale
│   ├── jarvis-rules.json            # Règles de style
│   ├── .jarvisignore                # Fichiers ignorés
│   └── jarvis-secrets.json          # Patterns de secrets custom
│
├── jarvis-tools/                   # Outils personnalisés
│   ├── my-tool.json                # Outil personnalisé JSON
│   └── validate-code.js             # Outil personnalisé JS
│
├── jarvis-agents/                  # Agents spécialisés
│   ├── qa-agent.json               # Agent QA
│   ├── doc-agent.json              # Agent Documentation
│   └── api-agent.json              # Agent API
│
├── jarvis-workflows/               # Workflows
│   ├── dev-feature.json            # Workflow développement
│   ├── bug-fix.json                # Workflow correction de bug
│   └── code-review.json             # Workflow revue de code
│
├── package.json                    # Métadonnées npm
├── tsconfig.json                   # Configuration TypeScript
├── vite.config.ts                  # Configuration Vite
├── tailwind.config.js              # Configuration Tailwind
└── README.md                       # Documentation
```

### 11.2. Dépendances du Projet

**Dépendances Principales (package.json)** :
```json
{
  "name": "jarvis-agent",
  "version": "2.0.0",
  "description": "Extension VS Code Agentique - Votre ingénieur logiciel autonome",
  "main": "dist/extension.js",
  "scripts": {
    "build": "vite build",
    "watch": "vite build --watch",
    "package": "npm run build && vsce package",
    "publish": "vsce publish",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "tree-sitter": "^0.21.0",
    "tree-sitter-javascript": "^0.20.0",
    "tree-sitter-typescript": "^0.20.0",
    "tree-sitter-python": "^0.20.0",
    "web-tree-sitter": "^0.20.0",
    "vectra": "^0.1.0",
    "@xenova/transformers": "^2.16.0",  // ✅ Alternative WASM à @tensorflow/tfjs
    "marked": "^12.0.0",
    "prismjs": "^1.29.0",
    "chart.js": "^4.4.0",
    "uuid": "^9.0.0",
    "ignore": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/vscode": "^1.90.0",
    "@vscode/vsce": "^3.0.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-basic-ssl": "^1.0.0",
    "svelte": "^4.0.0",
    "svelte-preprocess": "^5.0.0",
    "tailwindcss": "^4.0.0",
    "postcss": "^8.0.0",
    "autoprefixer": "^10.0.0",
    "vitest": "^1.0.0",
    "@testing-library/svelte": "^4.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "eslint": "^8.0.0",
    "prettier": "^3.0.0"
  },
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Programming Languages",
    "AI",
    "Productivity"
  ],
  "keywords": [
    "ai",
    "agent",
    "coding",
    "assistant",
    "ollama",
    "openrouter"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "contributes": {
    "commands": [
      {
        "command": "jarvis.startChat",
        "title": "Start Jarvis Chat"
      },
      {
        "command": "jarvis.rollback",
        "title": "Rollback to Checkpoint"
      },
      {
        "command": "jarvis.listCheckpoints",
        "title": "List Checkpoints"
      }
    ],
    "configuration": {
      "title": "Jarvis",
      "properties": {
        "jarvis.models.default": {
          "type": "string",
          "default": "deepseek-coder-v3",
          "description": "Modèle par défaut"
        },
        "jarvis.hitl.mode": {
          "type": "string",
          "default": "moderate",
          "enum": ["strict", "moderate", "free"],
          "description": "Mode HITL par défaut"
        }
      }
    }
  }
}
```

**Dépendances Frontend (pour les webviews)** :
- **Svelte** : Framework principal
- **Tailwind CSS** : Styling
- **marked** : Parsing Markdown
- **prismjs** : Syntax highlighting
- **Chart.js** : Graphiques du dashboard
- **uuid** : Génération d'IDs uniques

**Dépendances Backend** :
- **@modelcontextprotocol/sdk** : Client MCP
- **tree-sitter** : Parsing AST (backend Node.js)
- **web-tree-sitter** : Tree-sitter pour le browser (WASM) ✅
- **vectra** : Base vectorielle locale
- **@xenova/transformers** : Embeddings (WASM, remplace @tensorflow/tfjs) ✅
- **ignore** : Gestion des patterns .jarvisignore

### 11.3. Exemples de Code Complets

#### Exemple 1: Point d'Entrée de l'Extension (extension.ts)
```typescript
import * as vscode from 'vscode';
import { JarvisExtension } from './backend/core/extension';

export function activate(context: vscode.ExtensionContext) {
  console.log('Jarvis: Activation de l\'extension');
  
  // Initialiser l'extension
  const jarvis = new JarvisExtension(context);
  
  // Enregistrer les commandes
  const commands = [
    vscode.commands.registerCommand('jarvis.startChat', () => jarvis.startChat()),
    vscode.commands.registerCommand('jarvis.rollback', () => jarvis.showRollbackPanel()),
    vscode.commands.registerCommand('jarvis.listCheckpoints', () => jarvis.listCheckpoints()),
    vscode.commands.registerCommand('jarvis.exportAnalytics', () => jarvis.exportAnalytics()),
    vscode.commands.registerCommand('jarvis.generateJarvisIgnore', () => jarvis.generateJarvisIgnore())
  ];
  
  // Enregistrer les webviews
  const webviews = [
    vscode.window.registerWebviewViewProvider('jarvis.sidebar', jarvis.sidebarProvider),
    vscode.window.registerWebviewViewProvider('jarvis.chat', jarvis.chatProvider),
    vscode.window.registerWebviewViewProvider('jarvis.dashboard', jarvis.dashboardProvider)
  ];
  
  // Enregistrer les événements
  const eventListeners = [
    vscode.workspace.onDidSaveTextDocument(jarvis.onDocumentSaved.bind(jarvis)),
    vscode.workspace.onDidChangeTextDocument(jarvis.onDocumentChanged.bind(jarvis)),
    vscode.window.onDidChangeActiveTextEditor(jarvis.onActiveEditorChanged.bind(jarvis))
  ];
  
  // Ajouter au contexte pour le cleanup
  context.subscriptions.push(...commands, ...webviews, ...eventListeners);
  
  // Initialiser les services
  jarvis.initialize();
  
  console.log('Jarvis: Extension activée avec succès');
}

export function deactivate() {
  console.log('Jarvis: Désactivation de l\'extension');
}
```

#### Exemple 2: Configuration du Client MCP (mcp/client.ts)
```typescript
import { McpClient } from '@modelcontextprotocol/sdk';
import { FileSystemTool } from './tools/fileSystem';
import { TerminalTool } from './tools/terminal';
import { WebSearchTool } from './tools/webSearch';
import { GitTool } from './tools/git';

export class JarvisMcpClient {
  private client: McpClient;
  private tools: any[] = [];

  constructor() {
    this.client = new McpClient({
      name: 'jarvis-mcp-client',
      version: '2.0.0'
    });
    
    this.registerTools();
  }

  private registerTools(): void {
    // Outils système de fichiers
    this.tools.push(
      new FileSystemTool(this.client),
      new TerminalTool(this.client),
      new WebSearchTool(this.client),
      new GitTool(this.client)
    );
    
    // Outils personnalisés
    this.loadCustomTools();
  }

  private async loadCustomTools(): Promise<void> {
    // Charger les outils depuis jarvis-tools/
    // Logique de chargement dynamique
  }

  async connect(provider: string, apiKey?: string): Promise<void> {
    await this.client.connect({
      provider,
      apiKey,
      onMessage: this.handleMessage.bind(this),
      onError: this.handleError.bind(this)
    });
  }

  async sendPrompt(prompt: string, context?: any): Promise<string> {
    const response = await this.client.sendPrompt({
      prompt,
      context,
      stream: true
    });
    
    return this.processStream(response);
  }

  private async processStream(stream: AsyncIterable<string>): Promise<string> {
    let result = '';
    for await (const chunk of stream) {
      result += chunk;
      // Envoyer le chunk au frontend pour affichage en streaming
      this.emit('streamChunk', chunk);
    }
    return result;
  }

  private handleMessage(message: any): void {
    // Traitement des messages entrants
    console.log('MCP Message:', message);
  }

  private handleError(error: Error): void {
    console.error('MCP Error:', error);
    this.emit('error', error);
  }
}
```

#### Exemple 3: Composant de Chat Principal (ChatPanel.svelte)
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { vscode } from '../lib/vscode';
  import TokenGauge from './TokenGauge.svelte';
  import ThinkingBlock from './ThinkingBlock.svelte';
  import Message from './Message.svelte';
  
  export let webview: any;
  
  let messages: ChatMessage[] = [];
  let inputValue = '';
  let isThinking = false;
  let thinkingContent = '';
  let currentModel = 'deepseek-coder-v3';
  
  // Récupérer les messages depuis le backend
  onMount(async () => {
    const initialMessages = await vscode.getState('chatMessages');
    if (initialMessages) {
      messages = initialMessages;
    }
    
    // Écouter les messages du backend
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'newMessage':
          messages = [...messages, message.message];
          saveMessages();
          break;
        case 'streamChunk':
          updateLastMessage(message.chunk);
          break;
        case 'startThinking':
          isThinking = true;
          thinkingContent = message.content;
          break;
        case 'stopThinking':
          isThinking = false;
          break;
        case 'modelChanged':
          currentModel = message.model;
          break;
      }
    });
    
    // Demander l'historique au backend
    vscode.postMessage({ type: 'getHistory' });
  });
  
  function saveMessages() {
    vscode.setState('chatMessages', messages);
  }
  
  function updateLastMessage(chunk: string) {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && !lastMessage.complete) {
        messages[messages.length - 1] = {
          ...lastMessage,
          content: lastMessage.content + chunk
        };
        messages = messages;
      }
    }
  }
  
  async function sendMessage() {
    if (!inputValue.trim() || isThinking) return;
    
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString(),
      model: currentModel
    };
    
    messages = [...messages, userMessage];
    inputValue = '';
    saveMessages();
    
    // Envoyer au backend
    vscode.postMessage({
      type: 'sendMessage',
      message: userMessage.content,
      model: currentModel
    });
    
    // Ajouter un placeholder pour la réponse
    messages = [...messages, {
      id: (Date.now() + 1).toString(),
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      model: currentModel,
      complete: false
    }];
  }
  
  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }
</script>

<div class="jarvis-chat-panel">
  <!-- En-tête -->
  <div class="header">
    <h2>Jarvis Agent</h2>
    <TokenGauge model={currentModel} />
  </div>
  
  <!-- Zone de messages -->
  <div class="messages-container">
    {#if messages.length === 0}
      <div class="welcome-message">
        <h3>Bonjour ! Comment puis-je vous aider aujourd'hui ?</h3>
        <p>Essayez :</p>
        <ul>
          <li>"Crée une fonction de tri en JavaScript"</li>
          <li>"Corrige cette erreur : ..."</li>
          <li>"@QA-Agent vérifie ce code : ..."</li>
        </ul>
      </div>
    {/if}
    
    {#each messages as message (message.id)}
      <Message {message} />
    {/each}
    
    {#if isThinking}
      <ThinkingBlock content={thinkingContent} />
    {/if}
  </div>
  
  <!-- Zone d'entrée -->
  <div class="input-container">
    <textarea
      bind:value={inputValue}
      on:keydown={handleKeyDown}
      placeholder="Tapez votre message ici... (Ctrl+Enter pour nouvelle ligne)"
      rows="1"
    />
    <button on:click={sendMessage} disabled={!inputValue.trim() || isThinking}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" />
      </svg>
    </button>
  </div>
</div>

<style>
  .jarvis-chat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
  }
  
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--vscode-editorLineHighlight-background);
  }
  
  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
  }
  
  .input-container {
    display: flex;
    align-items: flex-end;
    padding: 1rem;
    border-top: 1px solid var(--vscode-editorLineHighlight-background);
    gap: 0.5rem;
  }
  
  textarea {
    flex: 1;
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 0.5rem;
    resize: none;
    max-height: 100px;
  }
  
  button {
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    padding: 0.5rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .welcome-message {
    text-align: center;
    padding: 2rem;
    color: var(--vscode-textLink-foreground);
  }
  
  .welcome-message ul {
    list-style: none;
    padding: 0;
  }
  
  .welcome-message li {
    padding: 0.5rem 0;
    color: var(--vscode-editorCodeLens-foreground);
  }
</style>
```

#### Exemple 4: Fichier de Configuration par Défaut (jarvis-config.json)
```json
{
  "$schema": "https://raw.githubusercontent.com/maxim-virtia/jarvis-agent/main/schemas/jarvis-config.schema.json",
  "version": "2.0",
  "metadata": {
    "createdAt": "2026-07-03T00:00:00Z",
    "createdBy": "jarvis-init",
    "jarvisVersion": "2.0.0"
  },
  
  "models": {
    "default": "deepseek-coder-v3",
    "providers": {
      "ollama": {
        "enabled": true,
        "baseUrl": "http://localhost:11434",
        "timeout": 120000,
        "models": [
          {
            "name": "qwen2.5-coder:7b",
            "contextLength": 32768,
            "description": "Modèle codage Qwen 7B - Léger et rapide",
            "recommendedFor": ["javascript", "typescript", "python", "java"]
          },
          {
            "name": "mistral-coder:7b",
            "contextLength": 32768,
            "description": "Modèle codage Mistral 7B - Bon pour le refactoring",
            "recommendedFor": ["typescript", "python", "c++"]
          },
          {
            "name": "deepseek-coder:6.7b",
            "contextLength": 16384,
            "description": "Modèle DeepSeek 6.7B - Très bon pour le raisonnement",
            "recommendedFor": ["python", "javascript", "reasoning"]
          }
        ]
      },
      "openrouter": {
        "enabled": false,
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "",
        "timeout": 60000,
        "models": [
          {
            "name": "deepseek-coder-v3",
            "contextLength": 262144,
            "description": "DeepSeek Coder V3 - Meilleur modèle de codage",
            "recommendedFor": ["all"],
            "pricing": {
              "input": 0.15,
              "output": 0.30,
              "currency": "USD",
              "unit": "M tokens"
            }
          },
          {
            "name": "gpt-4o",
            "contextLength": 131072,
            "description": "GPT-4o - Modèle polyvalent",
            "recommendedFor": ["complex", "creativity"],
            "pricing": {
              "input": 5.00,
              "output": 15.00,
              "currency": "USD",
              "unit": "M tokens"
            }
          }
        ]
      },
      "mistral": {
        "enabled": false,
        "baseUrl": "https://api.mistral.ai/v1",
        "apiKey": "",
        "timeout": 60000,
        "models": [
          {
            "name": "mistral-large",
            "contextLength": 32768,
            "description": "Mistral Large - Bon pour le texte et le code",
            "recommendedFor": ["text", "documentation", "code"],
            "pricing": {
              "input": 2.00,
              "output": 6.00,
              "currency": "USD",
              "unit": "M tokens"
            }
          },
          {
            "name": "codestral",
            "contextLength": 32768,
            "description": "Codestral - Spécialisé pour le code",
            "recommendedFor": ["code", "refactoring"],
            "pricing": {
              "input": 1.00,
              "output": 3.00,
              "currency": "USD",
              "unit": "M tokens"
            }
          }
        ]
      }
    }
  },
  
  "hitl": {
    "mode": "moderate",
    "alwaysAskFor": [
      "terminal:rm",
      "terminal:rm -rf",
      "terminal:git push",
      "terminal:git reset --hard",
      "terminal:npm install --global",
      "terminal:npm install -g",
      "write_file:.env",
      "write_file:.env.*",
      "edit_file:package.json",
      "edit_file:tsconfig.json",
      "edit_file:vite.config.ts"
    ],
    "neverAskFor": [
      "read_file",
      "list_directory"
    ],
    "globalPolicies": {
      "git": {
        "allow": ["status", "diff", "log", "add", "commit -m", "pull"],
        "ask": ["push", "reset", "rebase", "merge", "checkout"],
        "block": ["reset --hard", "push --force"]
      },
      "terminal": {
        "allow": ["ls", "cd", "pwd", "cat", "echo", "node", "npm run"],
        "ask": ["rm", "mv", "cp", "chmod", "chown", "kill", "pkill"],
        "block": ["rm -rf /", "rm -rf *", ":(){ :;};"],
        "timeout": 30000
      },
      "fileSystem": {
        "allow": ["read", "list"],
        "ask": ["write", "edit", "delete"],
        "block": []
      }
    },
    "sessionAllowances": []
  },
  
  "security": {
    "sandboxing": {
      "enabled": true,
      "allowOutsideWorkspace": false,
      "followSymlinks": false
    },
    "scrubbing": {
      "enabled": true,
      "providers": {
        "ollama": false,
        "openrouter": true,
        "mistral": true,
        "openai": true
      },
      "customPatterns": [],
      "actionOnSecret": "redact_and_warn"
    }
  },
  
  "checkpoints": {
    "enabled": true,
    "autoCreate": {
      "onDangerousAction": true,
      "onWorkflowStart": true,
      "onSessionStart": true
    },
    "retention": {
      "actionCheckpoints": 24,
      "workflowCheckpoints": 7,
      "sessionCheckpoints": 1,
      "manualCheckpoints": 30
    },
    "storage": {
      "useGitStash": true,
      "useGitTags": true
    }
  },
  
  "autoTDD": {
    "enabled": true,
    "maxAttempts": 5,
    "testCommand": "npm test",
    "testFramework": "jest",
    "timeout": 120000,
    "onFailure": {
      "analyzeLogs": true,
      "suggestFix": true,
      "askUser": false
    },
    "supportedFrameworks": ["jest", "mocha", "vitest", "pytest", "go test"]
  },
  
  "analytics": {
    "enabled": true,
    "tracking": {
      "tokens": true,
      "actions": true,
      "conversations": true,
      "performance": true,
      "errors": true
    },
    "storage": {
      "retentionDays": 90,
      "autoBackup": true,
      "backupFrequency": "daily"
    },
    "privacy": {
      "anonymizeFilePaths": false,
      "excludeContent": false
    },
    "budget": {
      "enabled": false,
      "monthlyLimit": 100.00,
      "warnAt": 80,
      "stopAt": 100
    }
  },
  
  "ui": {
    "theme": "auto",
    "showThinking": true,
    "streaming": true,
    "tokenGauge": {
      "show": true,
      "position": "right",
      "showDetails": true
    },
    "sidebar": {
      "width": 300,
      "position": "right"
    }
  },
  
  "features": {
    "webSearch": {
      "enabled": true,
      "providers": ["google", "stackoverflow", "mdn"],
      "maxResults": 5,
      "timeout": 10000,
      "blacklist": [
        "w3schools.com",
        "geeksforgeeks.org",
        "tutorialspoint.com"
      ]
    },
    "rag": {
      "enabled": true,
      "indexer": "vectra",
      "embeddingModel": "all-minilm",
      "indexedFiles": [
        "src/**/*.ts",
        "src/**/*.js",
        "src/**/*.py",
        "src/**/*.java"
      ],
      "ignoredFiles": [
        "node_modules/**",
        "dist/**",
        ".git/**",
        "*.min.js",
        "*.min.css"
      ],
      "maxResults": 5,
      "similarityThreshold": 0.7
    },
    "contextPruning": {
      "enabled": true,
      "strategy": "auto",
      "maxContextPercentage": 0.8
    },
    "microTasks": {
      "enabled": true,
      "autoDecompose": true,
      "maxDepth": 3
    }
  }
}
```

### 10.4. Ressources et Références

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

---

**Prochaines Étapes (Version 2.1 - Actionnable)** :

### 🚀 **Pour démarrer IMMÉDIATEMENT**

**Génération du projet de base (Recommandé)**
```bash
# 1. Installer Yeoman et le générateur VS Code
npm install -g yo generator-code

# 2. Générer le projet
mkdir jarvis-agent && cd jarvis-agent
yo code
# Choisir : "New Extension (TypeScript)"

# 3. Installer les dépendances de base
npm install
```

### 📞 **Support & Aide**

**Besoin d'aide pour** :
- [ ] Implémenter une fonctionnalité spécifique
- [ ] Résoudre un problème technique (build, dépendances, etc.)
- [ ] Comprendre un exemple de code
- [ ] Adapter une configuration
- [ ] Optimiser une partie de l'architecture
- [ ] Tester une fonctionnalité

**Ressources disponibles** :
- Documentation complète dans ce fichier
- Exemples de code fonctionnels (Section 10.3)
- Schémas de configuration (Section 10.4)
- Roadmap détaillée (Section 9)