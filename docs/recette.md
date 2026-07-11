# Cahier de Recette - Jarvis Agent

Ce document liste l'intégralité des scénarios de test pour s'assurer du parfait fonctionnement de toutes les briques de l'extension Jarvis. Suivez ces étapes chronologiquement pour valider l'architecture et les cas d'usages.

---

## 1. Paramétrage et Modèles (Providers)

### 1.1 Modèle distant (ex: OpenAI / OpenRouter)
- [X] **Action** : Dans l'onglet "Settings" de la webview, configurez un fournisseur (ex: OpenAI), ajoutez une clé API valide et sélectionnez un modèle (ex: `gpt-4o`).
- [X] **Test** : Posez une question simple comme "Bonjour, qui es-tu ?".
- [X] **Résultat attendu** : Jarvis répond rapidement en s'identifiant comme un assistant de code.

### 1.2 Modèle local (Ollama / LMStudio)
- [X] **Action** : Démarrez Ollama avec un modèle (ex: `ollama run llama3:8b`). Dans les Settings Jarvis, ajoutez un fournisseur Ollama (URL par défaut `http://localhost:11434`), et sélectionnez le modèle `llama3:8b`.
- [X] **Test** : Posez une question dans le chat en mode "Rapide".
- [X] **Résultat attendu** : Le modèle local répond. Aucune erreur réseau n'apparaît.

---

## 2. Modes de Chat et Routage Intelligent

### 2.1 Mode Rapide
- [X] **Action** : Sélectionnez le mode "Rapide". Demandez "Donne-moi une fonction pour faire une addition en JS".
- [X] **Résultat attendu** : Jarvis donne le code en texte. Il n'essaie pas d'exécuter des outils ni de créer de fichiers.

### 2.2 Mode Plan (Workflow strict)
- [X] **Action** : Sélectionnez le mode "Plan". Demandez "Je veux créer une API avec Express".
- [X] **Résultat attendu** : Jarvis n'écrit aucun code direct. Il utilise l'outil d'écriture pour générer un fichier `implementation_plan.md` décrivant les étapes, puis vous demande "Mon plan te convient-il ?" dans le chat.

### 2.3 Mode Automatique (Petit Modèle + Routage Dynamique)
- [X] **Action** : Activez un petit modèle local (ex: Ollama `llama3:8b`) ou un modèle contenant "7b"/"8b". Assurez-vous d'être en mode "Automatique". Demandez "Crée-moi un composant React Button complet".
- [X] **Résultat attendu** : L'extension détecte la présence d'un petit modèle et déclenche le workflow `dynamic`. Dans le chat ou via des logs d'étape, on doit voir le *Task Decomposer* créer des sous-étapes (Analyse, Exécution, Test) et les valider séquentiellement. 

### 2.4 Mode Automatique (Gros Modèle)
- [X] **Action** : Activez un modèle puissant (GPT-4, Claude-3.5-Sonnet) en mode "Automatique". Donnez une instruction de code simple.
- [X] **Résultat attendu** : Le modèle utilise directement ses outils (boucle agentique classique) sans passer par le workflow de décomposition `dynamic`.

---

## 3. Revue de Diff et CodeLens (Modifications de Fichiers)

### 3.1 Édition et Apparition des CodeLens
- [X] **Action** : Demandez à Jarvis de modifier un fichier existant (ex: "Ajoute un commentaire au début de index.ts").
- [X] **Résultat attendu** : Le fichier s'édite. VS Code affiche instantanément un fond vert sur la nouvelle ligne ajoutée. Au-dessus de la modification, les CodeLens cliquables `✓ Accept Hunk` et `✗ Reject Hunk` apparaissent. (En haut du fichier, `✓ Accept All Changes` doit apparaître).

### 3.2 Acceptation via CodeLens
- [X] **Action** : Cliquez sur `✓ Accept Hunk` dans l'éditeur.
- [X] **Résultat attendu** : Le fond vert disparaît. Le texte cliquable CodeLens disparaît. Le fichier est considéré comme validé et sauvé.

### 3.3 Rejet via CodeLens
- [X] **Action** : Demandez une autre modification. Cliquez sur `✗ Reject Hunk`.
- [X] **Résultat attendu** : Le texte ajouté par l'IA disparaît immédiatement de l'éditeur. Le fichier retourne à son état d'origine.

### 3.4 Édition en ligne (Cmd+K)
- [X] **Action** : Dans un fichier ouvert, sélectionnez une fonction, puis appuyez sur `Ctrl+K Ctrl+K` (ou `Cmd+K Cmd+K` sur Mac). Entrez un prompt (ex: "Ajoute un try/catch").
- [X] **Résultat attendu** : Jarvis s'active, comprend le contexte de la sélection et applique la modification directement dans l'éditeur via les outils d'édition. Les boutons d'acceptation de diff apparaissent.

---

## 4. Contexte, RAG Sémantique et Tree-Sitter (Pruning)

### 4.1 Mention `@file:`
- [X] **Action** : Dans le chat, tapez "Que fait la fonction main dans @file:src/index.ts".
- [X] **Résultat attendu** : Le contenu de `src/index.ts` est lu et injecté. Jarvis explique correctement le code.

### 4.2 Recherche RAG (Semantic Search) avec `@docs:`
- [X] **Prérequis** : Utilisez la commande `Jarvis: Index Workspace (RAG)` depuis la palette VS Code (Ctrl+Shift+P) pour vectoriser le projet. Attendez la notification de succès.
- [X] **Action** : Tapez une requête sémantique approximative : "Comment est gérée l'interface utilisateur @docs:".
- [X] **Résultat attendu** : Sans mot exact, la librairie `@xenova/transformers` (all-MiniLM-L6-v2) trouve les fichiers pertinents grâce aux embeddings cosinus. Jarvis utilise ce contexte pour répondre.

### 4.3 Context Pruning (AST Tree-Sitter)
- [X] **Action** : Demandez à Jarvis d'analyser un énorme fichier TS (> 1000 lignes) contenant de nombreuses fonctions, en lui disant de se focaliser sur UNE fonction spécifique.
- [X] **Résultat attendu** : L'agent doit lire le fichier, et grâce à `web-tree-sitter`, élaguer les fonctions inutiles (gardant seulement leurs signatures) pour ne lire que le corps de la fonction ciblée, ce qui réduit drastiquement la consommation de tokens visible dans la jauge.

---

## 5. Exécution de Commandes Terminal et HITL (Human In The Loop)

### 5.1 Mode Strict
- [X] **Action** : Dans les configurations, passez `jarvis.hitl.mode` à `strict`. Demandez "Fais un ls -la".
- [X] **Résultat attendu** : Avant d'exécuter la commande dans le terminal, une interface d'approbation s'affiche. Le bouton "Allow" doit être cliqué pour que la commande s'exécute.

### 5.2 Mode Moderate
- [X] **Action** : Passez en mode `moderate`. Demandez un `ls -la`.
- [X] **Résultat attendu** : La commande inoffensive `ls` s'exécute silencieusement et Jarvis vous donne le résultat.
- [X] **Action** : Demandez "Supprime le fichier toto.txt avec rm".
- [X] **Résultat attendu** : La commande destructive bloque l'exécution et vous demande une approbation formelle via la Webview ou une notification.

---

## 6. Auto-TDD Loop

### 6.1 Lancement d'une boucle TDD
- [X] **Action** : Dans le chat, tapez la commande `/tdd écris-moi une fonction fibonacci dans fib.ts`.
- [X] **Résultat attendu** : 
  1. L'agent crée le test unitaire pour Fibonacci (dans un fichier `.test.ts` ou `.spec.ts`).
  2. L'agent lance les tests en tâche de fond (la commande `npm test` configurée dans `jarvis.tdd.testCommand` échouera car l'implémentation manque).
  3. Il observe l'échec.
  4. L'agent écrit l'implémentation de `fib.ts`.
  5. Il relance les tests, qui doivent cette fois réussir.
  6. La boucle se termine avec un résumé.

---

## 7. Fonctionnalités Utilitaires

### 7.1 Jauge de Tokens (Statut Bar)
- [X] **Action** : Discutez et utilisez le contexte.
- [X] **Résultat attendu** : En bas à droite de l'éditeur VS Code, la barre de statut `$(hubot) Jarvis X%` s'incrémente. Le survol avec la souris indique les tokens In/Out. Au-delà d'un seuil critique (80%), elle passe en orange/rouge.

### 7.2 Checkpoints et Rollback
- [ ] **Action** : Effectuez plusieurs requêtes qui modifient le projet. Puis utilisez la commande `Jarvis: List Checkpoints` ou `/rollback`.
- [ ] **Résultat attendu** : Une liste des sauvegardes git (ou internes) s'affiche. Sélectionner un checkpoint précédent restaure les fichiers à l'état exact de ce moment-là.

### 7.3 `.jarvisignore`
- [ ] **Action** : Utilisez `Jarvis: Generate .jarvisignore` pour créer le fichier. Ajoutez-y un répertoire sensible (ex: `secrets/`). Demandez à Jarvis de lister les fichiers du projet.
- [ ] **Résultat attendu** : L'outil `list_dir` de Jarvis est aveugle au dossier `secrets/` et refuse d'y accéder, même via une lecture explicite de fichier.

### 7.4 Protocol MCP (Serveurs Externes)
- [ ] **Action** : Allez dans l'onglet Settings > MCP. Ajoutez un serveur MCP externe (par exemple le serveur local "sqlite" ou "brave-search").
- [ ] **Résultat attendu** : Le serveur s'initialise. Si vous demandez à l'Agent "Utilise Brave Search pour chercher les news du jour", il utilisera automatiquement l'outil fourni par le serveur MCP.

---

## 8. Interface Webview (UI)

### 8.1 Markdown et Code Highlighting
- [ ] **Action** : Demandez du code Python, HTML, et Rust.
- [ ] **Résultat attendu** : Le code est correctement coloré dans le Chat (PrismJS) avec un bouton de copie fonctionnel ("Copy to clipboard").

### 8.2 Bouton d'Annulation (Kill Switch)
- [ ] **Action** : Demandez à l'IA d'écrire un très long script ou lancez une boucle d'agent complexe. Pendant que l'IA génère sa réponse, cliquez sur le bouton "Stop" (carré) qui a remplacé le bouton d'envoi.
- [ ] **Résultat attendu** : La génération s'arrête instantanément, l'appel réseau est annulé (`AbortController`), et l'interface redevient disponible pour un nouveau message.

### 8.3 Navigation
- [ ] **Action** : Passez de l'onglet Chat à l'onglet Settings, puis Analytics.
- [ ] **Résultat attendu** : La transition est fluide (sans rechargement complet de la page). Les Settings conservent leurs valeurs.

---

## 9. Onboarding (Écran de Bienvenue)

### 9.1 Premier lancement (aucun modèle)
- [ ] **Prérequis** : Videz ou supprimez `~/.jarvis/config.json` (aucun modèle configuré), puis lancez l'Extension Development Host (`F5`).
- [ ] **Action** : Ouvrez le panneau Jarvis.
- [ ] **Résultat attendu** : Au lieu de la simple bannière « No model configured », un **écran de Bienvenue plein panneau** s'affiche : titre, indicateur d'étapes (Provider → Connexion → Tour) et une grille de fournisseurs (Ollama, OpenRouter, OpenAI, Anthropic, Mistral, LM Studio).

### 9.2 Test de connexion d'un provider
- [ ] **Action** : Choisissez un fournisseur (ex. Ollama), renseignez un modèle (ex. `qwen2.5-coder:7b`), cliquez « Continuer » puis « Tester la connexion ».
- [ ] **Résultat attendu** : Un « ping » est envoyé via un provider éphémère. En cas de succès, un bandeau vert « Connexion réussie » apparaît. En cas d'erreur (clé invalide, serveur éteint), un bandeau rouge affiche le message d'erreur. La config n'est PAS encore sauvegardée à ce stade.

### 9.3 Tour visuel des 3 features
- [ ] **Action** : Cliquez « Enregistrer et continuer ». Le modèle est persisté (via `updateSettings`) et devient le modèle par défaut. Le tour démarre.
- [ ] **Résultat attendu** : Trois slides successives présentent **le Chat agentique**, **l'édition inline Cmd+K** et **les @mentions** (`@file:` / `@docs:`). La navigation (points + Précédent/Suivant) fonctionne. Le bouton final « Commencer à coder » ferme l'écran et ouvre le chat.

### 9.4 Non-réaffichage après complétion
- [ ] **Action** : Rechargez la fenêtre (`Developer: Reload Window`).
- [ ] **Résultat attendu** : L'écran de Bienvenue **ne réapparaît pas** (l'état `jarvis.onboardingDone` est stocké dans le `globalState`). Le chat s'ouvre directement. (Un utilisateur déjà configuré arrive directement au tour la 1ʳᵉ fois, puis plus jamais.)

---

## 10. Prompt Caching (implicite + statistiques)

### 10.1 Tokens « cached » visibles dans la jauge
- [ ] **Prérequis** : Un modèle cloud avec cache implicite (OpenAI `gpt-4o-mini`, DeepSeek via OpenRouter…).
- [ ] **Action** : Envoyez un premier message long (grand contexte : règles + fichiers). Puis, dans la même discussion, envoyez un second message qui réutilise le même préfixe système.
- [ ] **Résultat attendu** : Dépliez la jauge de tokens (« Tokens used »). À partir du 2ᵉ message, une ligne verte **« ⚡ Cached: N »** apparaît, indiquant les tokens du prompt servis depuis le cache du provider (issus de `usage.prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens`).

### 10.2 Latence réduite sur préfixe stable
- [ ] **Action** : Comparez le temps de première réponse entre le 1ᵉʳ appel (cache froid) et les suivants (cache chaud).
- [ ] **Résultat attendu** : Les appels réutilisant le préfixe stable (system prompt + règles) répondent plus vite. Aucun réglage manuel : le cache est géré côté API tant que le préfixe reste identique d'un tour à l'autre.

---

## 11. Structured Outputs (JSON Mode)

### 11.1 Boucle agent sans casse de parsing
- [ ] **Prérequis** : Un petit modèle local (ex. Ollama `llama3:8b` ou `qwen2.5-coder:7b`).
- [ ] **Action** : Lancez `/agent crée un composant React Button` (ou un mode Automatique déclenchant l'orchestrateur).
- [ ] **Résultat attendu** : Les appels modèle de la boucle agent envoient `response_format: {type:'json_object'}` (OpenAI-compatible) ou `format:'json'` (Ollama). Le modèle renvoie systématiquement un JSON parsable ; **aucune erreur « Format inattendu »** n'interrompt la chaîne d'outils. `json-cleaner` reste un filet de sécurité.

### 11.2 Fallback automatique si non supporté
- [ ] **Action** : Utilisez un endpoint qui rejette `response_format` (certains serveurs OpenAI-compatible anciens).
- [ ] **Résultat attendu** : Au premier refus (HTTP 400 mentionnant `response_format`/`json`), l'orchestrateur **désactive le mode JSON pour ce provider** (mémorisé), journalise « Mode JSON non supporté… repli sur le prompt » dans l'OutputChannel, et **rejoue l'itération sans l'option**. La boucle continue normalement, sans nouvel essai coûteux aux requêtes suivantes.

---

## 12. Persistance de Session (Jauge & Historique)

### 12.1 Jauge restaurée après Reload Window
- [ ] **Action** : Discutez jusqu'à faire monter la jauge (tokens > 0), puis `Developer: Reload Window`.
- [ ] **Résultat attendu** : Après rechargement, la **jauge de tokens conserve sa valeur** (input/output/cached + historique des 5 dernières requêtes), restaurée depuis le `workspaceState` (`jarvis.tokenState`).

### 12.2 Historique du chat restauré
- [ ] **Action** : Après le reload, observez le panneau de chat.
- [ ] **Résultat attendu** : Les **messages de la discussion en cours réapparaissent** (rehydratation depuis `SessionStore` / `.vscode/jarvis-sessions.json`). La conversation peut continuer avec le contexte précédent.

### 12.3 Persistance après redémarrage complet
- [ ] **Action** : Fermez entièrement VS Code puis rouvrez le même workspace.
- [ ] **Résultat attendu** : Jauge et historique sont toujours présents (le `workspaceState` survit au redémarrage). `/new` remet à zéro la jauge ET l'instantané persisté.

---

**Cahier de test clôturé.** Si toutes ces étapes fonctionnent comme prévu, l'extension est robuste, **prête pour la publication sur le VS Code Marketplace (V1.0)** et l'utilisation optimale avec n'importe quel LLM.
