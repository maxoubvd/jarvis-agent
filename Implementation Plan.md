# Correctifs Ctrl+K, Affichage Prompt Inline et .jarvisignore Automatique

Trois bugs/manques identifiés lors de la recette de l'édition inline (`Ctrl+K Ctrl+K`) et de la génération automatique du `.jarvisignore`.

---

## Bug 1 : Fichier créé en itération N supprimé en itération N+1

### Analyse de la cause racine

> [!CAUTION]
> **Correction (version précédente de ce document) :** la première rédaction de cette section avançait trois théories différentes (rejet de review, rechargement du `SandboxManager`, contournement du sandbox par un MCP externe) sans trancher, et concluait sur une hypothèse non vérifiée. Vérification faite sur le code actuel : deux des trois théories sont infirmées. Voir ci-dessous.

Le `ChangeTracker` (revue de diffs) enregistre toute création de fichier avec `before = null` (fichier n'existait pas). Le rejet d'un fichier entier renvoie `{ path, content: file.before }` ([change-tracker.ts:L126](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/services/change-tracker.ts#L126)) — pour un fichier créé, `file.before` vaut `null`, donc le rejet **supprime bien le fichier**. C'est un comportement voulu (rejeter une création = l'annuler), pas un bug.

**Théories écartées après vérification :**
- ❌ *Rechargement du `SandboxManager` entre itérations* : `runAgent` appelle bien `new SandboxManager().ensureIgnoreFile()` ([extension.ts:L1438](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/extension.ts#L1438)), mais une seule fois par appel `runAgent` (donc par invocation Ctrl+K), pas par itération de la boucle outil. Cette instance temporaire ne remplace pas le singleton `sandbox` de `fileSystem.ts` (`getSandbox()`), donc aucun rechargement de patterns ne se produit entre les itérations d'une même boucle agent.
- ❌ *Contournement du sandbox par le MCP filesystem externe* : le serveur MCP `filesystem` intégré (`@modelcontextprotocol/server-filesystem`, [builtin.ts:L42-53](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/mcp/builtin.ts#L42-L53)) est lancé avec le dossier du workspace comme unique répertoire autorisé (`args: [..., workspaceFolder]`). Il ne peut donc pas écrire hors du workspace via cette voie — sauf si un **autre** serveur MCP `filesystem` global (configuré ailleurs sur la machine, hors de ce projet) est utilisé à la place, auquel cas ce n'est pas un bug de l'extension mais une question de configuration MCP côté utilisateur.

**Cause confirmée** : dans `inlineEdit()` ([extension.ts:L1789-1791](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/extension.ts#L1789-L1791)), `filePath = doc.uri.fsPath` est un chemin **absolu**, injecté tel quel dans le prompt envoyé au LLM (L1799). Rien n'empêche le modèle de réutiliser cet absolu dans ses appels d'outils. Tant que ce chemin reste sous la racine du workspace ouvert, `resolveWorkspacePath()` ([fileSystem.ts:L49-51](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/mcp/tools/fileSystem.ts#L49-L51)) le résout correctement via `path.resolve(workspaceFolder, filePath)` (qui ignore `workspaceFolder` si `filePath` est déjà absolu) et l'accès fonctionne. **Le cas qui casse réellement** est celui où l'éditeur actif pointe vers un fichier **hors du dossier actuellement ouvert dans VS Code** (ex. workspace ouvert = `Extension VS Code`, fichier édité = `Recette Jarvis\fonctions.py`) : le chemin absolu est alors rejeté par `SandboxManager.canAccess()` (`Chemin hors du workspace`) pour toute tentative ultérieure de lecture/édition par les outils internes de Jarvis, alors que la création initiale (si faite par un outil externe non sandboxé) a pu réussir.

> [!IMPORTANT]
> Passer en chemin relatif au workspace ne change rien si le fichier est réellement hors du dossier ouvert (`asRelativePath` renverra alors l'absolu tel quel) — dans ce cas la vraie cause est que l'utilisateur édite un fichier n'appartenant à aucun dossier du workspace VS Code, ce qui est une limite structurelle du sandbox, pas un bug ponctuel. Le correctif ci-dessous reste utile car il **normalise le prompt envoyé au LLM** et évite d'induire le modèle à réutiliser un chemin absolu quand le fichier est bien dans le workspace (cas normal, très majoritaire).

### Correctif proposé

#### [MODIFY] [extension.ts](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/extension.ts)

Dans la méthode `inlineEdit()` (ligne 1763-1813) :
- Le `filePath` utilisé dans le task est `doc.uri.fsPath` (chemin absolu), injecté tel quel dans le prompt envoyé au LLM.
- **Convertir le chemin en chemin relatif au workspace** via `vscode.workspace.asRelativePath()` — évite d'exposer un chemin absolu au modèle et supprime tout risque qu'il le réutilise mal dans un appel d'outil. Ne résout pas le cas où le fichier édité est hors du dossier ouvert (voir analyse ci-dessus) : ce cas restera bloqué par le sandbox, ce qui est le comportement de sécurité attendu.

```diff
-    const filePath = doc.uri.fsPath;
+    const filePath = vscode.workspace.asRelativePath(doc.uri, false);
```

---

## Bug 2 : Le prompt Ctrl+K n'est pas affiché dans le chat

### Analyse

Dans `inlineEdit()` ([extension.ts:L1801-1804](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/extension.ts#L1801-L1804)) :
- Le `task` est ajouté au `this.history` (backend) mais **aucun message `injectUserMessage` n'est posté au webview**.
- La réponse de l'agent apparaît dans le chat (via `agentFinal`, `chatChunk`, etc.) mais le prompt de l'utilisateur n'est jamais affiché.

Il faudrait :
1. **Poster un message `injectUserMessage`** vers le webview avec un format spécial pour les prompts inline.
2. **Créer un nouveau `MessageKind`** (`'inline'`) pour différencier visuellement les prompts Ctrl+K des messages chat normaux.
3. **Ajouter un style spécial** dans le ChatPanel pour ces messages (icône ✎, fond différent, mention du fichier/lignes).

### Correctif proposé

#### [MODIFY] [types.ts](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/frontend/shared/types.ts)
- Ajouter `'inline'` au type `MessageKind`.

#### [MODIFY] [extension.ts](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/extension.ts)
- Dans `inlineEdit()`, poster un `inlinePrompt` vers le webview **avant** d'appeler `runAgent()` :

```typescript
// Affiche le prompt inline dans le chat
this.post(this._view.webview, { 
  type: 'inlinePrompt', 
  prompt,
  file: filePath,
  startLine,
  endLine
});
```

#### [MODIFY] [App.svelte](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/frontend/App.svelte)
- Ajouter un handler pour le message `inlinePrompt` qui crée un message utilisateur avec un kind `'inline'` :

```typescript
case 'inlinePrompt':
  pushMessage('user', msg.prompt, 'inline', [
    { icon: '✎', label: `${msg.file} L${msg.startLine}-${msg.endLine}`, variant: 'info' }
  ]);
  isSending = true;
  break;
```

#### [MODIFY] [ChatPanel.svelte](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/frontend/components/ChatPanel.svelte)
- Ajouter un style CSS spécial pour les messages de kind `'inline'` (icône ✎, fond légèrement différent, badge avec le fichier ciblé).

---

## Bug 3 : `.jarvisignore` non créé automatiquement

### Analyse

Le code dans [extension.ts:L10-11](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/extension.ts#L10-L11) appelle `getSandbox()` dans la fonction `activate()`, ce qui instancie un `SandboxManager`. Le constructeur appelle `loadIgnorePatterns()` ([sandbox.ts:L23](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/utils/sandbox.ts#L23)), qui appelle `generateDefaultIgnoreSync()` si le fichier n'existe pas.

> [!CAUTION]
> **Correction (version précédente de ce document) :** le problème le plus grave n'était pas mentionné. L'appel `getSandbox()` en L11 de `src/extension.ts` n'est entouré d'**aucun** `try/catch`. Or le constructeur de `SandboxManager` ([sandbox.ts:L16-24](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/utils/sandbox.ts#L16-L24)) lève une exception synchrone (`throw new Error('Workspace introuvable')`) si aucun dossier n'est ouvert (`vscode.workspace.workspaceFolders` vide/undefined — cas normal quand l'utilisateur ouvre VS Code sans dossier). Cette exception remonte et fait échouer `activate()` **avant** l'enregistrement des commandes et `jarvis.initialize()` (lignes 13-26) : **toute l'extension reste inactive**, pas seulement la génération du `.jarvisignore`. C'est la cause principale à corriger, avant même le problème d'écriture silencieuse ci-dessous.

**Problème secondaire** : `generateDefaultIgnoreSync()` ([sandbox.ts:L120-138](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/utils/sandbox.ts#L120-L138)) utilise `fsSync.writeFileSync()` dans un `try/catch` qui avale silencieusement les erreurs (permissions, disque, etc.), et n'écrit qu'une version abrégée du fichier (3 lignes) au lieu du contenu complet de `generateDefaultIgnoreAsync()`.

De plus, `runAgent` appelle `new SandboxManager().ensureIgnoreFile()` ([extension.ts:L1438](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/extension.ts#L1438)) — mais ceci est appelé dans un `try { ... } catch { /* ignore */ }`, avalant encore les erreurs (ce point-là était déjà correctement identifié).

### Correctif proposé

#### [MODIFY] [extension.ts (entry)](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/extension.ts)
- Déplacer la création du `.jarvisignore` **après** l'initialisation complète, en utilisant l'API asynchrone avec un `setTimeout` pour laisser le workspace se charger :

```diff
 export function activate(context: vscode.ExtensionContext) {
   console.log('Jarvis: activation de l\'extension');
   const jarvis = new JarvisExtension(context);
   
-  // Génère le fichier .jarvisignore automatiquement s'il n'existe pas
-  getSandbox();
+  // Génère le fichier .jarvisignore automatiquement après que le workspace soit prêt
+  setTimeout(async () => {
+    try {
+      const sandbox = getSandbox();
+      await sandbox.ensureIgnoreFile();
+    } catch (err) {
+      console.warn('Jarvis: impossible de créer .jarvisignore:', err);
+    }
+  }, 1000);
```

#### [MODIFY] [sandbox.ts](file:///c:/Users/maxim/Documents/virtia/Extension%20VS%20Code/src/backend/core/utils/sandbox.ts)
- Améliorer `generateDefaultIgnoreSync()` pour logger les erreurs au lieu de les avaler silencieusement.
- Utiliser le contenu complet (identique à `generateDefaultIgnoreAsync`) au lieu de la version abrégée.

---

## Verification Plan

### Automated Tests
```bash
npm test
```

### Manual Verification
1. **Ctrl+K** : Ouvrir un fichier, sélectionner du code, faire Ctrl+K Ctrl+K, entrer un prompt → vérifier que :
   - Le fichier créé persiste entre les itérations
   - Le prompt apparaît dans le chat avec un style spécial (badge avec le fichier)
   - La réponse de l'agent apparaît dans le chat
2. **`.jarvisignore`** : Supprimer le fichier `.jarvisignore` du workspace, recharger VS Code → vérifier qu'il est recréé automatiquement sous ~1 seconde.
3. **Build** : Vérifier que `npm run build` compile sans erreur.
