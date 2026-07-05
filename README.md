# Jarvis Agent

Extension VS Code "Jarvis Agent" pour l'assistance de développement et l'automatisation via IA.

## Installation

1. Ouvrez le workspace dans VS Code.
2. Exécutez `npm install`.
3. Exécutez `npm run build`.
4. Pour tester localement, ouvrez le dossier dans VS Code, lancez `F5` et utilisez la fenêtre `Extension Development Host` qui s'ouvre.
5. Si vous voulez générer un package VSIX, mettez à jour `publisher` dans `package.json` puis exécutez `npm run package`.

> Note : en développement, `npm run build` compile le backend et le frontend. La commande `Jarvis: Start Chat` ouvre le panneau webview `Jarvis Chat` et charge le bundle Svelte depuis `dist/webview/assets/app.js`.

## Structure du projet

- `src/extension.ts` : point d'entrée VS Code.
- `src/backend/` : logique de l'extension et intégration MCP.
- `src/frontend/` : interface webview Svelte.
- `jarvis/jarvis-config.json` : configuration des modèles et providers.

## Build

- `npm run build` : compile l'extension et le frontend.
- `npm run test` : exécute les tests.
