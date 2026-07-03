# Jarvis Agent - Backend

Ce README décrit l'architecture backend actuelle de l'extension Jarvis Agent et le fonctionnement des composants disponibles.

## Objectif

Le backend sert de point d'intégration pour VS Code, orchestre les outils MCP et gère les interactions avec les modèles IA.

## Structure actuelle

### `src/extension.ts`

C'est le point d'entrée de l'extension VS Code.
- Active l'extension avec `activate(context)`.
- Enregistre trois commandes :
  - `jarvis.startChat`
  - `jarvis.rollback`
  - `jarvis.listCheckpoints`
- Crée une instance de `JarvisExtension` et l'initialise.

### `src/backend/core/extension.ts`

Cette classe encapsule la logique principale de l'extension.
- `initialize()` : méthode d'initialisation (actuellement un placeholder).
- `startChat()` : affiche une notification VS Code indiquant le démarrage du chat.
- `showRollbackPanel()` : affiche une notification pour rollback.
- `listCheckpoints()` : affiche une notification pour la liste des checkpoints.

### `src/backend/core/mcp/client.ts`

Client MCP minimal.
- Instancie `McpClient` depuis `@modelcontextprotocol/sdk`.
- `initialize()` est une méthode placeholder pour la configuration future.

### `src/backend/core/mcp/tools/`

Outils MCP actuellement présents :
- `fileSystem.ts`
- `terminal.ts`
- `git.ts`
- `webSearch.ts`

#### `fileSystem.ts`

- Exporte `readFileTool(filePath: string)`.
- Résout le chemin relatif dans le workspace VS Code.
- Lit le fichier en UTF-8 et renvoie le contenu.
- Valide que le workspace est ouvert.

#### `terminal.ts`

- Exporte `executeTerminalCommand(command: string)`.
- Crée un terminal VS Code nommé `Jarvis Terminal`.
- Envoie la commande et affiche le terminal.

#### `git.ts`

- Exporte `gitStatus()`.
- Utilise `executeGitCommand('git status --short')`.
- Crée un terminal VS Code nommé `Jarvis Git`.

#### `webSearch.ts`

- Exporte `webSearch(query: string)`.
- Retourne une réponse simulée.
- Composant de démonstration en attente d'une implémentation réelle.

### `src/backend/models/`

Composants de gestion des modèles IA.

#### `abstract.ts`

- Définit l'interface `IModelProvider`.
- Méthode requise : `sendPrompt(prompt: string): Promise<string>`.

#### `config.ts`

- Définit les interfaces de configuration des providers :
  - `ModelConfig`
  - `ProviderConfig`

#### `providers/ollama.ts`

- Classe `OllamaProvider` implémentant `IModelProvider`.
- Simule une réponse pour les prompts.

#### `providers/openrouter.ts`

- Classe `OpenRouterProvider` implémentant `IModelProvider`.
- Simule une réponse pour les prompts.

### Résumé des capacités backend actuelles

- Extension activable et commandes VS Code fonctionnelles.
- Architecture de base de backend en TypeScript.
- Client MCP minimal prêt à être étendu.
- Outils MCP pour lecture de fichier, terminal, git et recherche web.
- Support abstrait de providers IA avec deux implémentations simulées.

## Ce qui manque encore

- `write_file` et `edit_file` pour la modification de fichiers.
- Intégration complète de `JarvisMcpClient` avec outils et provider.
- Logique métier réelle pour l'activation des modèles.
- Gestion avancée de la sécurité, du sandboxing et des checkpoints.
- Messages et échanges réels entre frontend et backend.

## Comment démarrer

1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Compiler le backend :
   ```bash
   npm run build:extension
   ```
3. Lancer l'extension dans VS Code via le débogueur.

## Notes techniques

- Le backend utilise TypeScript avec ciblage ES2020.
- Les chemins sont résolus depuis le premier dossier workspace.
- Le backend dépend de `@modelcontextprotocol/sdk` pour le client MCP.
- Le backend expose déjà les outils MCP via `src/backend/core/mcp/index.ts`.
