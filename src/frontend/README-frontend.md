# Jarvis Agent - Frontend

Ce README décrit l'architecture frontend actuelle de l'extension Jarvis Agent et les composants en place.

## Objectif

Le frontend est responsable de l'affichage de la webview et de l'interface utilisateur de base pour Jarvis Agent.

## Structure actuelle

### `src/frontend/index.html`

- Point d'entrée HTML pour la webview.
- Contient un élément `div#app` pour monter l'application Svelte.
- Charge le script `main.ts`.

### `src/frontend/main.ts`

- Bootstrap de l'application Svelte.
- Monte `App.svelte` sur `document.getElementById('app')`.

### `src/frontend/App.svelte`

- Composant principal de l'application.
- Affiche un message de bienvenue.
- Contient des styles de base utilisant les variables VS Code :
  - `--vscode-editor-foreground`
  - `--vscode-editor-background`
  - `--vscode-font-family`
  - `--vscode-descriptionForeground`

### Composants existants

#### `src/frontend/components/ChatPanel.svelte`

- Composant de chat de base.
- Affiche un titre et une zone de messages.
- Sert de base pour l'interface conversationnelle.

#### `src/frontend/components/TokenGauge.svelte`

- Composant d'indicateur de tokens.
- Affiche un pourcentage de tokens utilisés.
- Utilise le style VS Code pour les couleurs et l'apparence.

#### `src/frontend/components/Sidebar.svelte`

- Composant de barre latérale.
- Contient un titre et une section de contenu.
- Structure de base pour l'ajout de contrôle ou de navigation.

#### `src/frontend/components/ThinkingBlock.svelte`

- Bloc d'affichage de la pensée en cours.
- Peut être utilisé pour afficher un état de traitement.

#### `src/frontend/components/Dashboard/Analytics.svelte`

- Composant dashboard de statistiques.
- Affiche un titre et un message de statut.

#### `src/frontend/components/Dashboard/TokenStats.svelte`

- Composant pour afficher l'utilisation de tokens.
- Structure simple pour les stats.

#### `src/frontend/components/Dashboard/Performance.svelte`

- Composant pour afficher un taux de succès.
- Structure simple pour les métriques.

### Bibliothèques et utilitaires

#### `src/frontend/lib/utils.ts`

- Contient une fonction utilitaire `formatDate`.
- Utilitaire minimal prêt à être étendu.

#### `src/frontend/shared/constants.ts`

- Définit `APP_NAME`.
- Peut accueillir d'autres constantes globales.

#### `src/frontend/shared/types.ts`

- Définit l'interface `Message`.
- Interface de base pour le chat et les messages.

#### `src/frontend/shared/utils.ts`

- Contient une fonction `clamp`.
- Utilitaire réutilisable pour les valeurs numériques.

## Ce qui fonctionne actuellement

- L'application Svelte démarre avec un message de bienvenue.
- La structure des composants est présente.
- Les composants de base sont prêts à être intégrés à une UI complète.
- Les styles de base utilisent les variables natives de VS Code.

## Ce qui manque encore

- Connexion entre le frontend et le backend.
- Gestion réelle des messages de chat et de l'état de l'application.
- Interaction avec les outils MCP et le système de modèles.
- Interface d'entrée utilisateur pour envoyer des prompts.
- Dashboard opérationnel et graphiques réels.
- Intégration complète de Tailwind CSS dans les composants.

## Comment démarrer

1. Installer les dépendances :
   ```bash
   npm install
   ```
2. Lancer le build webview :
   ```bash
   npm run build:webview
   ```
3. Ouvrir l'extension dans VS Code et vérifier la webview via le débogage.

## Notes techniques

- Le frontend est construit avec Svelte 4.
- Le build est piloté par Vite.
- Le frontend cible une webview VS Code et utilise des variables CSS natives.
- Le frontend est prêt à recevoir de la logique de chat et des données backend.
