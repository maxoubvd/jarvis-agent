Contexte

8 demandes utilisateur sur l'extension VS Code « Jarvis Agent » :
1. Bug de navigation dans les paramètres (impossible de ré-ouvrir la sidebar / de changer de page)
2. MCP : Fetch non connecté, serveurs manquants à l'affichage, liste des tools par serveur avec activation/désactivation individuelle
3. Remplacer toutes les cases à cocher enable/disable par des toggles « lightswitch »
4. Confirmer ~/.jarvis/config.json + bouton « Modifier le fichier de config »
5. Agents/workflows/règles par défaut visibles dans leurs sections
6. Jauge de tokens dépendante du modèle configuré (sinon 0 / — (0%))
7. Formulaire d'ajout de modèle enrichi, schéma centré modèle (style Continue)
8. Section « Prompts » (bibliothèque de prompts personnels)

Décisions validées par l'utilisateur : Fetch réimplémenté en Node in-process (zéro dépendance externe) ; schéma de config centré modèle avec migration automatique ; rôles = chat, edit, apply, autocomplete, embed, rerank, summarize ; prompts MCP natifs reportés à plus tard.

Diagnostics confirmés :
- Bug nav (1) : .app-shell { min-height: 100vh } dans App.svelte:440 → c'est le document qui défile, pas .main-content ; en mode étroit (<500px, cas normal d'une webview) le header avec le bouton ☰ disparaît dès qu'on scrolle la longue page Settings → navigation inaccessible.
- Fetch (2) : lancé via uvx (Python uv, non installé) alors que Memory utilise npx (builtin.ts). Il existe 4 builtins (memory, filesystem, git, fetch) ; filesystem/git n'apparaissent que si un dossier est ouvert, git/fetch désactivés par défaut.
- Config (4) : ~/.jarvis/config.json est bien réel (config-manager.ts:169), fusionné avec l'override workspace jarvis/jarvis-config.json.
- Tokens (6) : getContextLength() retombe sur 32768 codé en dur (model-config-manager.ts:149-157).
- (5) : agents/workflows sont déjà pré-remplis depuis les défauts (SettingsPanel.svelte:117-122) ; les règles n'ont pas de défauts (rien à afficher — garder le texte explicatif) ; les custom tools jarvis-tools/*.json ne sont pas affichés.

Ordre d'exécution

1. WS7 schéma modèles (fondation — tout le reste touche les mêmes fichiers)
2. WS6 limite de tokens (dépend de WS7)
3. WS2 MCP
4. WS8 prompts + WS5 défauts/custom tools
5. WS4 bouton config
6. WS3 Toggle + WS1 fix scroll (pur frontend, appliqués à toutes les nouvelles sections)

Gate npm run build && npm run test après WS7, WS2, et à la fin.

---
WS7 — Schéma de config centré modèle

src/backend/config/config-manager.ts :
export type ModelRole = 'chat'|'edit'|'apply'|'autocomplete'|'embed'|'rerank'|'summarize';
export type ModelCapability = 'tool_use'|'image_input';
export type ProviderType = 'ollama'|'openai'|'openrouter'|'lmstudio'|'mistral'|'openai-compatible'; // + 'openai'
export interface ModelItem {
  name: string; provider: ProviderType; model: string;
  apiKey?: string; apiBase?: string;
  roles?: ModelRole[]; capabilities?: ModelCapability[];
  contextLength?: number; maxTokens?: number; enabled?: boolean; // enabled défaut true
}
// JarvisConfig.models: { default: string | null; items: ModelItem[] }
- Migration dans normalizeConfig() (s'exécute à chaque chargement → couvre global ET workspace) : si raw.models.providers existe et pas items, mapper chaque providers[key].models[i] → ModelItem { name: m.name, provider: inferType(key), model: m.name, apiKey: p.apiKey, apiBase: p.baseUrl, contextLength: m.contextLength, enabled: p.enabled, roles: ['chat','edit','apply'] }. Idempotent (ne pas re-migrer si items présent). EMPTY_CONFIG.models = { default: null, items: [] }.
- Déplacer DEFAULT_BASE_URL (SettingsPanel.svelte:69) dans config-manager.ts, l'exporter, ajouter openai: 'https://api.openai.com/v1'.
- Garder les anciens types exportés (dépréciés) pour la migration/tests.

Réécrire src/backend/config/model-config-manager.ts :
- initializeProviders() : itérer models.items.filter(m => m.enabled !== false), map clé = nom du modèle ; instancier selon item.provider (openai → OpenAICompatibleProvider) avec { baseUrl: item.apiBase ?? DEFAULT_BASE_URL[item.provider], apiKey, model: item.model, maxTokens }.
- getModelForRole(role): ModelItem | null ; getContextLength(name): number | null — supprimer le fallback 32768.
- getProviderNameForModel / isCloudProvider désormais clés par nom de modèle — vérifier tous les call sites dans extension.ts (scrubber notamment).
- Attention : name (affichage, = models.default) ≠ model (id envoyé à l'API).

Providers (src/backend/models/providers/) : accepter maxTokens optionnel → max_tokens dans openai-compatible.ts (send + stream), options.num_predict dans ollama.ts.

Frontend : miroir des types dans src/frontend/shared/types.ts.

Nouveau src/frontend/components/settings/ModelsSection.svelte (remplace le bloc Providers de SettingsPanel.svelte:338-440) — formulaire par modèle : Name, Provider (liste : mistral/openrouter/openai/ollama/lmstudio/autre ; « autre » = openai-compatible et révèle apiBase ; apiBase pré-rempli et modifiable pour les autres), Model id, apiKey (masqué pour ollama/lmstudio), roles (7 toggles), capabilities (tool_use, image_input), contextLength, maxTokens (facultatif), toggle enabled, radio « default ». Pattern callback comme AgentsSection.

SettingsPanel.svelte : remplacer l'état providers par modelItems, synchro dans le $effect, sérialiser models: { default, items }.

Tests : réécrire test/backend/config-manager.test.ts (migration ancien→nouveau, idempotence, config vide) et les cas ModelConfigManager (rôle, apiKey par modèle, contextLength null).

WS6 — Limite de tokens liée au modèle

- src/backend/services/token-counter.ts : limit: number | null (défaut null), percentage = 0 et level green si null, isNearLimit() false si null. TokenUsage.limit: number | null.
- extension.ts (~281, ~400, ~464) : setLimit(model ? getContextLength(model) : null).
- TokenGauge.svelte : afficher {used} / {limit ?? '—'} ({limit ? pct : 0}%), jauge à 0 si null. App.svelte:41 : tokensLimit = $state<number | null>(null).
- Tests token-counter (limit null).

WS2 — MCP : fetch in-process, builtins toujours visibles, toggles par tool

Nouveau src/backend/core/mcp/in-process.ts :
- createFetchServer(): McpServer (SDK @modelcontextprotocol/sdk/server/mcp.js) — tool fetch(url, max_length=5000, start_index=0, raw=false) : fetch() global, strip <script>/<style>, conversion HTML→markdown-lite en regex (h1-h6 → #, a → [text](href), li → - , blocs → sauts de ligne, décodage entités). Zéro nouvelle dépendance.
- IN_PROCESS_SERVERS: Record<string, () => McpServer>.

src/backend/core/mcp/builtin.ts :
- fetch : inProcess: true, enabled: true par défaut, description « intégré, aucune dépendance externe ». builtinCommandString → '(built-in)' pour l'in-process.
- git : reste uvx opt-in ; dans le manager, si l'erreur est un ENOENT sur uvx, préfixer « uv (uvx) introuvable — installez https://docs.astral.sh/uv/ ».
- filesystem/git toujours listés même sans dossier ouvert : enabled: false forcé + suffixe description « (requires an open folder) » ; resolveServers() ne tente pas la connexion mais getStatuses() les liste.

src/backend/core/mcp/client.ts : 3e arg optionnel inProcessFactory?: () => McpServer ; buildTransport() → InMemoryTransport.createLinkedPair() (@modelcontextprotocol/sdk/inMemory.js), connecter le serveur de la factory à un bout, retourner l'autre.

src/backend/core/mcp/manager.ts + config :
- disabledTools?: string[] sur McpServerConfig ET builtinMcp[id] (config-manager + normalize + types.ts frontend).
- resolveServers() fusionne les disabledTools des overrides ; toToolDefinitions() filtre les tools désactivés ; getStatuses() retourne tools: { name; description; enabled }[].
- Changement de payload mcpStatus : déplacer McpServerStatus dans shared/types.ts (partagé App.svelte:61,115 + SettingsPanel:22-28) pour éviter la dérive.

Frontend : extraire src/frontend/components/settings/McpSection.svelte (SettingsPanel fait 933 lignes). Carte serveur (builtin + custom) dépliable (chevron) : liste des tools (nom/description) avec Toggle par tool écrivant dans disabledTools. Serveur non connecté → « connect to list tools ». serializeBuiltinMcp() émet une entrée si enabled diffère OU disabledTools non vide.

Tests : builtin-mcp.test.ts (fetch in-process activé par défaut ; filesystem/git listés sans workspace mais non connectés) ; nouveau test du serveur fetch in-process (paire liée + stub du fetch global) ; mcp-manager.test.ts (disabledTools filtre toToolDefinitions, flag dans getStatuses).

WS8 — Bibliothèque de prompts

- Config : prompts?: PromptItem[] ({ id; name; description?; content }) + miroir types.ts.
- Nouveau src/frontend/components/settings/PromptsSection.svelte (pattern AgentsSection, sans défauts) ; wiring état + serialize() dans SettingsPanel.
- Backend : nouveau src/backend/services/prompts.ts avec helper pur expandPrompt(text, prompts) ; dans onChatMessage, /nomDuPrompt args → content + '\n\n' + args (noms /tdd, /workflow, /agent réservés). capabilities inclut prompts: {name, description}[] → extraCommands (trigger /) dans App.svelte.
- Test : test/backend/prompts.test.ts.

WS5 — Défauts visibles

- Agents/workflows : déjà OK (pré-remplissage défauts) — vérifier après refonte.
- Règles : pas de défauts, texte explicatif conservé.
- Custom tools : getSettingsDefaults() (extension.ts) ajoute customTools: {name, description}[] depuis loadCustomTools() ; liste read-only en bas du groupe MCP (« définis dans jarvis-tools/*.json — éditez les fichiers pour modifier »). Miroir dans SettingsDefaults (types.ts:141).

WS4 — Bouton « Edit config file »

- Bouton secondaire dans le header de SettingsPanel.svelte → prop onOpenConfig → App.svelte poste { type: 'openConfigFile' }.
- extension.ts : case openConfigFile → showTextDocument(openTextDocument(Uri.file(configManager.getGlobalConfigPath()))). Ajouter getGlobalConfigPath() public à ConfigManager (chemin déjà calculé ligne 169 ; loadSync crée le fichier si absent).

WS3 — Composant Toggle « lightswitch »

- Nouveau src/frontend/components/Toggle.svelte (~60 lignes) : { checked, onchange, label?, disabled? } ; <input type="checkbox"> masqué dans un <label> (a11y), piste/curseur avec variables VS Code (--vscode-button-background on, --vscode-input-background off), glissement gauche→droite.
- Remplacer les 8 sites de checkbox : SettingsPanel.svelte:367 (→ enabled dans ModelsSection), :459 builtin MCP, :502 custom MCP, :552 rules, :615 showThinking ; DocsSection.svelte:79 ; WorkspacesSection.svelte:69 ; + toutes les nouvelles sections (roles/capabilities/enabled des modèles, tools MCP, prompts). Standardiser sur checked + onchange (élimine l'incohérence bind/onchange actuelle).
- La radio « default model » (:414) reste une radio.

WS1 — Fix du scroll / navigation

- App.svelte:440 : .app-shell { height: 100vh; overflow: hidden; } (au lieu de min-height) → .main-content (déjà overflow: auto; min-height: 0) devient l'unique conteneur de scroll ; le header (☰) et la sidebar inline restent visibles sur tous les onglets.
- Vérifier que le header sticky de Settings colle bien dans .main-content ; ChatPanel gère son propre scroll (OK) ; Checkpoints/Analytics couverts par le même fix ; drawer/backdrop (z-20/21) inchangés.
- Durcissement : overflow: hidden sur body dans le CSS global si présent (src/frontend/main.ts / app.css).

---
Risques transverses

1. serialize() de SettingsPanel : tout nouveau champ (disabledTools, prompts, models.items) doit être ajouté à la sérialisation sinon il est silencieusement perdu à la sauvegarde — vecteur de régression n°1.
2. Payload mcpStatus (tools: string[] → objets) : type unique partagé dans shared/types.ts.
3. Idempotence migration : ne pas re-migrer un config déjà au nouveau format ; normalizeConfig doit propager explicitement les nouvelles clés.
4. Nom de modèle vs id API : models.default, message setModel, isCloudProvider clés par nom d'affichage ; l'instance provider porte l'id API.
5. getSettings renvoie la config globale brute (extension.ts:433) : getGlobalConfig() doit renvoyer la forme normalisée/migrée pour que l'UI ne voie jamais l'ancien schéma.

Vérification

1. npm run build && npm run test (vitest).
2. F5 → Extension Development Host :
  - Rétrécir la sidebar <500px, ouvrir Settings, scroller en bas → le bouton ☰ reste visible, la navigation fonctionne (bug 1).les nouvelles clés.
4. Nom de modèle vs id API : models.default, message setModel, isCloudProvider clés par nom d'affichage ; l'instance provider porte l'id API.
5. getSettings renvoie la config globale brute (extension.ts:433) : getGlobalConfig() doit renvoyer la forme normalisée/migrée pour que l'UI ne voie jamais l'ancien schéma.

Vérification

1. npm run build && npm run test (vitest).
2. F5 → Extension Development Host :
  - Rétrécir la sidebar <500px, ouvrir Settings, scroller en bas → le bouton ☰ reste visible, la navigation fonctionne (bug 1).
  - Section MCP : 4 builtins affichés, Fetch connecté sans uv installé ; déplier Fetch → désactiver son tool → Save → l'agent ne voit plus mcp__fetch__fetch.
  - Ajouter un modèle via le nouveau formulaire → jauge 0 / <contextLength> ; supprimer tous les modèles → 0 / — (0%).
  - Enregistrer un prompt → le menu / du chat le propose ; /monprompt suite développe le contenu.
  - Bouton « Edit config file » → ouvre ~/.jarvis/config.json dans l'éditeur.
  - Tous les enable/disable sont des lightswitchs ; agents/workflows par défaut visibles ; custom tools listés.

───────────────────────────────────────────────────────── 1 new message ──────────────────────────────────────────────────────────

Plan approuvé. Je crée la liste de tâches puis j'attaque WS7 (schéma de config centré modèle).

  Reading 11 files…
  ⎿  src\backend\services\token-counter.ts

✢ Migration du schéma de config modèles… (2m 33s · ↓ 9.6k tokens)
◼ WS7 — Schéma de config centré modèle + migration
◻ WS6 — Limite de tokens liée au modèle configuré
◻ WS2 — MCP : fetch in-process, builtins visibles, toggles par tool
◻ WS8 — Bibliothèque de prompts
◻ WS5 — Custom tools visibles dans les paramètres
 … +4 pending
                       You've used 92% of your session limit · resets 11:10pm (Europe/Paris) · /upgrade to keep using Claude Code
──────────────────────────────────────────────────────────────────────────────────────────────── jarvis-agent-settings-refactor ──
❯
──────────────────────────────











✻ Migration du schéma de config modèles… (2m 28s ·