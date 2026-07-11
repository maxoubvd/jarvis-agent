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
- [X] **Action** : Effectuez plusieurs requêtes qui modifient le projet. Puis utilisez la commande `Jarvis: List Checkpoints` ou `/rollback`.
- [X] **Résultat attendu** : Une liste des sauvegardes git (ou internes) s'affiche. Sélectionner un checkpoint précédent restaure les fichiers à l'état exact de ce moment-là.

### 7.3 `.jarvisignore`
- [X] **Action** : Utilisez `Jarvis: Generate .jarvisignore` pour créer le fichier. Ajoutez-y un répertoire sensible (ex: `secrets/`). Demandez à Jarvis de lister les fichiers du projet.
- [X] **Résultat attendu** : L'outil `list_dir` de Jarvis est aveugle au dossier `secrets/` et refuse d'y accéder, même via une lecture explicite de fichier.

### 7.4 Protocol MCP (Serveurs Externes)
- [X] **Action** : Allez dans l'onglet Settings > MCP. Ajoutez un serveur MCP externe (par exemple le serveur local "sqlite" ou "brave-search").
- [X] **Résultat attendu** : Le serveur s'initialise. Si vous demandez à l'Agent "Utilise Brave Search pour chercher les news du jour", il utilisera automatiquement l'outil fourni par le serveur MCP.

---

## 8. Interface Webview (UI)

### 8.1 Markdown et Code Highlighting
- [X] **Action** : Demandez du code Python, HTML, et Rust.
- [X] **Résultat attendu** : Le code est correctement coloré dans le Chat (PrismJS) avec un bouton de copie fonctionnel ("Copy to clipboard").

### 8.2 Bouton d'Annulation (Kill Switch) 
- [X] **Action** : Demandez à l'IA d'écrire un très long script ou lancez une boucle d'agent complexe. Pendant que l'IA génère sa réponse, cliquez sur le bouton "Stop" (carré) qui a remplacé le bouton d'envoi.
- [X] **Résultat attendu** : La génération s'arrête instantanément, l'appel réseau est annulé (`AbortController`), et l'interface redevient disponible pour un nouveau message.

### 8.3 Navigation
- [X] **Action** : Passez de l'onglet Chat à l'onglet Settings, puis Analytics.
- [X] **Résultat attendu** : La transition est fluide (sans rechargement complet de la page). Les Settings conservent leurs valeurs.

---

## 9. Onboarding (Écran de Bienvenue)

### 9.1 Premier lancement (aucun modèle)
- [X] **Prérequis** : Videz ou supprimez `~/.jarvis/config.json` (aucun modèle configuré), puis lancez l'Extension Development Host (`F5`).
- [X] **Action** : Ouvrez le panneau Jarvis.
- [X] **Résultat attendu** : Au lieu de la simple bannière « No model configured », un **écran de Bienvenue plein panneau** s'affiche : titre, indicateur d'étapes (Provider → Connexion → Tour) et une grille de fournisseurs (Ollama, OpenRouter, OpenAI, Anthropic, Mistral, LM Studio).

### 9.2 Test de connexion d'un provider
- [X] **Action** : Choisissez un fournisseur (ex. Ollama), renseignez un modèle (ex. `qwen2.5-coder:7b`), cliquez « Continuer » puis « Tester la connexion ».
- [X] **Résultat attendu** : Un « ping » est envoyé via un provider éphémère. En cas de succès, un bandeau vert « Connexion réussie » apparaît. En cas d'erreur (clé invalide, serveur éteint), un bandeau rouge affiche le message d'erreur. La config n'est PAS encore sauvegardée à ce stade.

### 9.3 Tour visuel des 3 features
- [X] **Action** : Cliquez « Enregistrer et continuer ». Le modèle est persisté (via `updateSettings`) et devient le modèle par défaut. Le tour démarre.
- [X] **Résultat attendu** : Trois slides successives présentent **le Chat agentique**, **l'édition inline Cmd+K** et **les @mentions** (`@file:` / `@docs:`). La navigation (points + Précédent/Suivant) fonctionne. Le bouton final « Commencer à coder » ferme l'écran et ouvre le chat.

### 9.4 Non-réaffichage après complétion
- [X] **Action** : Rechargez la fenêtre (`Developer: Reload Window`).
- [X] **Résultat attendu** : L'écran de Bienvenue **ne réapparaît pas** (l'état `jarvis.onboardingDone` est stocké dans le `globalState`). Le chat s'ouvre directement. (Un utilisateur déjà configuré arrive directement au tour la 1ʳᵉ fois, puis plus jamais.)

---

## 10. Prompt Caching (implicite + statistiques)

### 10.1 Tokens « cached » visibles dans la jauge
- [X] **Prérequis** : Un modèle cloud avec cache implicite (OpenAI `gpt-4o-mini`, DeepSeek via OpenRouter…).
- [X] **Action** : Envoyez un premier message long (grand contexte : règles + fichiers). Puis, dans la même discussion, envoyez un second message qui réutilise le même préfixe système.
- [X] **Résultat attendu** : Dépliez la jauge de tokens (« Tokens used »). À partir du 2ᵉ message, une ligne verte **« ⚡ Cached: N »** apparaît, indiquant les tokens du prompt servis depuis le cache du provider (issus de `usage.prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens`).

### 10.2 Latence réduite sur préfixe stable
- [X] **Action** : Comparez le temps de première réponse entre le 1ᵉʳ appel (cache froid) et les suivants (cache chaud).
- [X] **Résultat attendu** : Les appels réutilisant le préfixe stable (system prompt + règles) répondent plus vite. Aucun réglage manuel : le cache est géré côté API tant que le préfixe reste identique d'un tour à l'autre.

---

## 11. Structured Outputs (JSON Mode)

### 11.1 Boucle agent sans casse de parsing
- [X] **Prérequis** : Un petit modèle local (ex. Ollama `llama3:8b` ou `qwen2.5-coder:7b`).
- [X] **Action** : Lancez `/agent crée un composant React Button` (ou un mode Automatique déclenchant l'orchestrateur).
- [X] **Résultat attendu** : Les appels modèle de la boucle agent envoient `response_format: {type:'json_object'}` (OpenAI-compatible) ou `format:'json'` (Ollama). Le modèle renvoie systématiquement un JSON parsable ; **aucune erreur « Format inattendu »** n'interrompt la chaîne d'outils. `json-cleaner` reste un filet de sécurité.

### 11.2 Fallback automatique si non supporté
- [X] **Action** : Utilisez un endpoint qui rejette `response_format` (certains serveurs OpenAI-compatible anciens).
- [X] **Résultat attendu** : Au premier refus (HTTP 400 mentionnant `response_format`/`json`), l'orchestrateur **désactive le mode JSON pour ce provider** (mémorisé), journalise « Mode JSON non supporté… repli sur le prompt » dans l'OutputChannel, et **rejoue l'itération sans l'option**. La boucle continue normalement, sans nouvel essai coûteux aux requêtes suivantes.

---

## 12. Persistance de Session (Jauge & Historique)

### 12.1 Jauge restaurée après Reload Window
- [X] **Action** : Discutez jusqu'à faire monter la jauge (tokens > 0), puis `Developer: Reload Window`.
- [X] **Résultat attendu** : Après rechargement, la **jauge de tokens conserve sa valeur** (input/output/cached + historique des 5 dernières requêtes), restaurée depuis le `workspaceState` (`jarvis.tokenState`).

### 12.2 Historique du chat restauré
- [X] **Action** : Après le reload, observez le panneau de chat.
- [X] **Résultat attendu** : Les **messages de la discussion en cours réapparaissent** (rehydratation depuis `SessionStore` / `.vscode/jarvis-sessions.json`). La conversation peut continuer avec le contexte précédent.

### 12.3 Persistance après redémarrage complet
- [X] **Action** : Fermez entièrement VS Code puis rouvrez le même workspace.
- [X] **Résultat attendu** : Jauge et historique sont toujours présents (le `workspaceState` survit au redémarrage). `/new` remet à zéro la jauge ET l'instantané persisté.

---

---

## 13. Finalisation v1 (audit du 11/07/2026)

Scénarios couvrant les 9 chantiers de finalisation issus de `docs/audit-2026-07-11.md`. À exécuter après un `npm run build` propre (backend + webview).

### 13.1 Agents spécialisés — restriction d'outils réelle

- [X] **Action** : Tapez `@Security-Agent audite ce fichier et corrige les failles que tu trouves` sur un fichier contenant un problème évident (ex: secret en dur).
- [X] **Résultat attendu** : L'agent lit le code et liste les problèmes, mais **ne tente jamais** d'appeler `edit_existing_file`/`create_new_file`/`run_terminal_command` (il n'a pas ces outils — si le modèle essaie, l'orchestrateur renverra "Outil inconnu"). Il vous propose le correctif en texte plutôt que de l'appliquer.
- [X] **Action** : Tapez `@QA-Agent lance les tests du projet et résume les échecs`.
- [X] **Résultat attendu** : L'agent utilise `run_terminal_command`/`grep_search` sans éditer de fichier.
- [X] **Action** : Dans Settings > Agents, dépliez un agent et vérifiez le champ "Allowed tools" — modifiez-le (ex: retirez `run_terminal_command` de QA-Agent), sauvegardez, puis redemandez une tâche à cet agent.
- [X] **Résultat attendu** : La modification est prise en compte immédiatement (pas besoin de recharger la fenêtre).

### 13.2 Ouverture automatique du fichier édité

- [X] **Action** : Demandez à l'agent de modifier 2-3 fichiers différents dans une même tâche (ex: "renomme la fonction foo en bar dans ces 3 fichiers").
- [X] **Résultat attendu** : Après chaque édition, le fichier concerné s'ouvre au premier plan dans l'éditeur (onglet en italique = "preview"), et les décorations vert/rouge sont visibles. Un seul onglet preview est réutilisé à chaque édition suivante (pas d'empilement de 3 onglets distincts).
- [X] **Action** : Dans Settings > Optimization, passez "Auto-open edited files" à `never`, puis redemandez une édition.
- [X] **Résultat attendu** : Le fichier n'est plus amené au premier plan automatiquement (vous devez toujours accepter/rejeter via le panneau de revue de diff dans le chat, qui reste inchangé).

### 13.3 Recherche web (Brave Search API)

- [ ] **Prérequis** : Obtenez une clé API gratuite sur [api.search.brave.com/app/keys](https://api.search.brave.com/app/keys), renseignez-la dans Settings > Web Search.
- [ ] **Action** : Demandez "Cherche sur le web la dernière version stable de Svelte".
- [ ] **Résultat attendu** : L'agent appelle `search_web` et obtient de vrais résultats (titres + liens + extraits), pas un message d'erreur.
- [ ] **Action** : Sans clé API configurée (retirez-la), redemandez la même chose.
- [ ] **Résultat attendu** : L'outil répond que la recherche web n'est pas configurée (pas de crash, pas d'erreur réseau visible).
- [ ] **Action** : Dans Settings > Web Search, cochez "stackoverflow.com" comme source par défaut, puis redemandez une recherche sans préciser de site.
- [ ] **Résultat attendu** : Les résultats sont restreints à StackOverflow (vérifiable dans les URLs retournées).

### 13.4 `JARVIS.md` et commande `/init`

- [X] **Action** : Sur un dossier qui n'est pas encore un dépôt git, tapez `/init` dans le chat.
- [X] **Résultat attendu** : Une boîte de dialogue demande confirmation pour `git init` ; après acceptation, un dossier `.git` apparaît, puis l'agent analyse le projet et crée `JARVIS.md` à la racine avec les sections Project Overview / Build & Test Commands / Architecture / Conventions / Notes for Agents.
- [X] **Action** : Relancez `/init` alors que `JARVIS.md` existe déjà.
- [X] **Résultat attendu** : Une confirmation est demandée avant d'écraser le fichier existant ; en refusant, le fichier reste inchangé.
- [X] **Action** : Éditez manuellement `JARVIS.md` pour y ajouter une instruction distinctive (ex: "Réponds toujours en commençant par 🚀"), puis posez une question dans le chat.
- [X] **Résultat attendu** : L'agent respecte l'instruction — confirmant que `JARVIS.md` est bien injecté dans le prompt système (agents, workflows, et chat direct).
- [X] **Test palette** : `Ctrl+Shift+P` → `Jarvis: Initialize Project (generate JARVIS.md)`.
- [X] **Résultat attendu** : Ouvre la sidebar et déclenche `/init` comme ci-dessus.

### 13.5 Règles par dossier

- [X] **Action** : Dans Settings > Rules, créez une règle "Backend only" avec le contenu "Utilise toujours des imports relatifs avec suffixe .js" et un scope `src/backend/**`.
- [X] **Action** : Ouvrez un fichier dans `src/backend/`, posez une question générale à l'agent (n'importe laquelle, pour vérifier l'injection du prompt).
- [X] **Résultat attendu** : La règle s'applique (visible si vous demandez à l'agent de citer ses instructions, ou observable dans le style du code généré).
- [X] **Action** : Ouvrez un fichier dans `src/frontend/` à la place, reposez une question.
- [X] **Résultat attendu** : La règle scopée à `src/backend/**` ne s'applique plus.

### 13.6 Checklist TODO visuelle

- [X] **Action** : Lancez `/workflow dev-feature ajoute une fonction utilitaire de formatage de date`.
- [X] **Résultat attendu** : **Avant même le début de la première étape**, une checklist "Tasks (0/4)" apparaît au-dessus de la zone de saisie avec les 4 étapes du workflow (Planifier/Coder/Tester/Commiter). Chaque étape passe à "in_progress" puis "completed" au fur et à mesure.
- [X] **Action** : Une fois le workflow terminé, tapez `/new`.
- [X] **Résultat attendu** : La checklist disparaît.
- [X] **Action** : Lancez une tâche agentique simple (`/agent ...`) sur un modèle qui supporte bien les tool calls, en lui demandant explicitement de "découper la tâche en étapes avec la checklist".
- [X] **Résultat attendu** : Le modèle peut appeler l'outil `update_todo_list` et la checklist apparaît/se met à jour sans jamais demander de confirmation HITL (même en mode strict).

### 13.7 Autocomplete inline (Tab)

- [X] **Prérequis** : Dans Settings > Optimization, activez "Inline autocomplete (Tab)" (désactivé par défaut).
- [X] **Action** : Ouvrez un fichier de code, placez le curseur en fin de ligne incomplète (ex: `const total = `), attendez ~0.5s sans taper.
- [X] **Résultat attendu** : Un texte fantôme (ghost text) grisé apparaît proposant une complétion ; `Tab` l'accepte, `Échap` ou continuer à taper l'annule.
- [X] **Action** : Continuez à taper rapidement sans pause.
- [X] **Résultat attendu** : Aucune requête n'est déclenchée tant que vous tapez (debounce) — pas de ghost text qui clignote à chaque frappe.
- [X] **Action** : Désactivez le réglage, retestez.
- [X] **Résultat attendu** : Plus aucune complétion ne se déclenche.
- [X] **Optionnel** : Dans Settings > Models, taguez un modèle local rapide (ex. Ollama `qwen2.5-coder:7b`) avec le rôle `autocomplete`, puis retestez.
- [X] **Résultat attendu** : Les complétions utilisent ce modèle plutôt que le modèle de chat par défaut.

### 13.8 Nettoyage UI (non-régression)

- [X] **Action** : Dans Settings > Models, dépliez un modèle et regardez les toggles de rôles.
- [X] **Résultat attendu** : Seuls `chat`, `edit`, `apply`, `autocomplete` sont proposés (plus de `embed`/`rerank`/`summarize`).
- [X] **Action** : Changez le mode HITL dans Settings (Optimization > HITL mode) sans cliquer sur "Save".
- [X] **Résultat attendu** : Le changement est appliqué immédiatement (visible dans le comportement d'approbation d'une commande terminal suivante), pas seulement après sauvegarde.
- [X] **Action** : Videz le chat (aucun message), observez l'état vide.
- [X] **Résultat attendu** : Deux boutons "New chat" / "Resume past conversation" sont visibles et fonctionnels.
- [X] **Action** : Passez en mode "Plan", laissez l'agent proposer un plan.
- [X] **Résultat attendu** : Le bouton "Review" affiche une icône crayon correcte (plus de rond générique) ; de même pour le badge "Working..." (icône puce) et le bouton stop (icône carré).
- [X] **Action** : Dans Settings > Models, sélectionnez le provider "huggingface".
- [X] **Résultat attendu** : Le champ "API base URL" se pré-remplit correctement (plus de champ vide/`undefined`).

---

**Cahier de test clôturé.** Si toutes ces étapes fonctionnent comme prévu, l'extension est robuste, **prête pour la publication sur le VS Code Marketplace (V1.0)** et l'utilisation optimale avec n'importe quel LLM.
