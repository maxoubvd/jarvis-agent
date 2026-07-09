<div align="center">
  <img src="docs/media/logo_jarvis.png" alt="Jarvis Agent Logo" width="150"/>
  <h1>Jarvis Agent</h1>
  <p><strong>Votre ingénieur logiciel autonome, directement dans VS Code.</strong></p>
</div>

---

**Jarvis Agent** est une extension de nouvelle génération pour Visual Studio Code. Que vous souhaitiez automatiser la création de composants, débugger un système complexe, ou explorer une immense base de code, Jarvis s'intègre parfaitement à votre environnement local pour vous assister.

![Aperçu de l'interface](docs/media/overview_chat_interface.png)
*(Aperçu de l'interface de discussion de Jarvis)*

---

## ✨ Fonctionnalités Clés

### 1. Édition en Ligne (Cmd+K)
Sélectionnez n'importe quel bloc de code, appuyez sur `Cmd+K Cmd+K` (ou `Ctrl+K Ctrl+K` sur Windows/Linux), et donnez une instruction à Jarvis (ex: *"Ajoute une gestion d'erreur robuste à cette fonction"*).

<video src="docs/media/demo_cmd_k.mp4" controls width="100%"></video>

L'IA écrit le code en direct, et les **CodeLens (`✓ Accept` / `✗ Reject`)** vous permettent d'approuver ou de refuser la modification ligne par ligne.

### 2. Compréhension du Contexte (RAG & Pruning AST)
Jarvis ne souffre pas de la limite de tokens typique des autres IAs :
- **@file** : Référencez instantanément des fichiers précis dans vos requêtes.
- **RAG Sémantique (`@docs`)** : Recherchez dans vos documentations et votre projet entier par concept, pas seulement par mots-clés.
- **AST Pruning** : Jarvis analyse la structure syntaxique (avec `tree-sitter`) pour ne lire que les fonctions importantes d'un fichier géant sans saturer le contexte.

![RAG et Pruning AST](docs/media/rag_context_pruning.png)

### 3. Exécution Autonome (Terminal & TDD)
Jarvis n'écrit pas seulement du code, il l'exécute.
- **Workflow TDD** : Tapez `/tdd écris-moi une fonction fibonacci` et Jarvis écrira le test, tentera de l'exécuter, verra l'erreur, écrira l'implémentation et vérifiera que le test passe.
- **Terminal Intégré** : L'agent peut lancer `npm install`, `git commit` ou `cargo build`. **Human-in-the-Loop (HITL)** : en mode strict, il vous demande d'abord la permission.

<video src="docs/media/demo_tdd_loop.mp4" controls width="100%"></video>

### 4. Connecté à Tout (Standard MCP)
Grâce au **Model Context Protocol (MCP)**, Jarvis peut utiliser des outils externes. Connectez-le à GitHub, à une base de données PostgreSQL, ou à Brave Search directement depuis l'onglet Settings.

---

## 🚀 Installation & Démarrage Rapide

1. Installez **Jarvis Agent** depuis le Marketplace VS Code.
2. Appuyez sur l'icône de Jarvis dans la barre latérale gauche (ou command `Jarvis: Start Chat`).
3. **L'écran de Bienvenue** vous guidera pour configurer votre premier modèle !

![Ecran de Bienvenue](docs/media/onboarding_welcome.png)

### Compatibilité des Fournisseurs
Jarvis est **Agnostique**. Vous choisissez le cerveau de votre agent :
- **En Local (Gratuit & Privé)** : Connectez **Ollama** ou **LM Studio** en un clic. Nous recommandons des modèles récents comme `qwen2.5-coder:7b` ou `llama3:8b`.
- **Sur le Cloud (Ultra Performant)** : Utilisez les API de **OpenRouter**, **OpenAI**, **Anthropic** ou **HuggingFace** pour profiter de GPT-4o ou Claude 3.5 Sonnet.

---

## 📖 Guide d'Utilisation Avancé (User Guide)

### Les Modes de Discussion
- **Automatique** : Jarvis analyse la taille du modèle et la complexité de la tâche pour choisir entre une réponse texte, ou un workflow de décomposition (Task Decomposer).
- **Rapide** : Seulement de la réponse texte rapide, sans exécution d'outil.
- **Plan** : Jarvis crée toujours un plan Markdown (`implementation_plan.md`) pour que vous validiez l'architecture avant qu'il ne touche au code.

### Raccourcis Claviers
- `Cmd+K Cmd+K` (Mac) ou `Ctrl+K Ctrl+K` (Win) : Édition inline d'une sélection de code.
- `/new` : Démarre une nouvelle conversation (nettoie le contexte).
- `/rollback` : Ouvre la liste des "Checkpoints" pour annuler complètement l'impact de Jarvis sur votre projet.

### Bouton "Kill Switch"
Si Jarvis s'emballe ou si l'exécution d'une commande tourne en boucle, utilisez le bouton d'arrêt (Carré) dans le panneau de chat pour stopper l'Agent sur-le-champ et couper la connexion réseau.

---

## ⚙️ Paramètres & Configuration Avancée

Toute la configuration est stockée dans `~/.jarvis/config.json`.
Vous pouvez paramétrer Jarvis visuellement via l'onglet **Settings** :
- Régler la verbosité (Concis / Détaillé).
- Cacher ou afficher les pensées de l'agent.
- Gérer le `jarvisignore` pour l'empêcher d'accéder à certains dossiers sensibles.
- Configurer les profils des serveurs MCP.

![Panneau des paramètres](docs/media/settings_panel.png)

---

## 🤝 Contribution & Support
Jarvis est un projet communautaire pensé par des développeurs, pour des développeurs.
- Des idées, des bugs ? Ouvrez une [Issue sur GitHub](#).
- Vous voulez contribuer ? Les Pull Requests sont les bienvenues !

<div align="center">
  <p>Créé pour la communauté VS Code.</p>
</div>