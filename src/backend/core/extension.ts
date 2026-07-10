import * as vscode from 'vscode';
import * as fs from 'fs';
import { ModelConfigManager, createProviderFromItem } from '../config/model-config-manager.js';
import { getConfigManager, normalizeConfig, type JarvisConfig, type DocSite, type ToolPolicy, type ModelItem } from '../config/config-manager.js';
import { ChatMessage, IModelProvider } from '../models/abstract.js';
import { SessionStore, buildResumeContext } from '../services/sessions.js';
import { HITLManager, HITLMode, ApprovalPromptDecision } from '../services/hitl.js';
import { CheckpointManager } from '../services/checkpoint.js';
import { AnalyticsCollector } from '../services/analytics.js';
import { TokenCounter, TokenUsage, TokenSnapshot, estimateTokens } from '../services/token-counter.js';
import { ResponseCache } from '../services/response-cache.js';
import { AutoTDDLoop } from '../services/tdd-loop.js';
import { detectAgentMention, suggestAgent, getAgents } from '../services/agents.js';
import { WorkflowRunner, getWorkflows } from '../services/workflows.js';
import { loadRules, renderRules } from '../services/rules.js';
import { loadPrompts, expandPrompt, normalizePromptName } from '../services/prompts.js';
import { getActiveWorkspace, renderWorkspaceInstructions } from '../services/workspaces.js';
import { WorkspaceIndexer } from '../services/context/indexer.js';
import { expandMentions } from '../services/context/mentions.js';
import { DocsService, mergeSearchResults } from '../services/context/docs.js';
import type { RagSearchResult } from '../services/context/rag.js';
import { augmentWithCodeContext } from '../services/context/rag.js';
import { operationLogger } from '../services/logger.js';
import { SecretScrubber } from './utils/scrubber.js';
import { SandboxManager } from './utils/sandbox.js';
import { AgentOrchestrator, buildAgentSystemPrompt, AgentEvents } from './agent/orchestrator.js';
import { ToolRegistry, createBuiltinTools } from './agent/tool-registry.js';
import { ChangeTracker } from '../services/change-tracker.js';
import { isBuiltinShadowed, type ActiveMcpTools } from './agent/builtin-dedup.js';
import { JarvisCodeLensProvider } from './codelens.js';
import { DiffDecorationProvider } from './diff-decorations.js';
import * as path from 'path';
import { loadCustomTools } from './agent/custom-tools.js';
import {
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  setSandbox
} from './mcp/tools/fileSystem.js';
import { executeTerminalCommand } from './mcp/tools/terminal.js';
import { McpManager } from './mcp/manager.js';
import { getBuiltinMcpServers, builtinCommandString } from './mcp/builtin.js';

const BASE_SYSTEM_PROMPT =
  'Tu es Jarvis, un assistant de code agentique intégré à VS Code. ' +
  'Réponds de manière concise et technique. Utilise le Markdown pour formater ton code.\n' +
  'RÈGLE CRITIQUE : Ne t\'enferme jamais dans une boucle. Si tu te surprends à répéter la même action, la même commande ou écrire le même fichier plusieurs fois, ARRÊTE-TOI IMMÉDIATEMENT, considère la tâche comme terminée (ou bloquée) et donne ta réponse finale.';

/** Clé workspaceState : instantané de la jauge de tokens (persistance de session). */
const TOKEN_STATE_KEY = 'jarvis.tokenState';
/** Clé globalState : l'onboarding a été complété au moins une fois. */
const ONBOARDING_DONE_KEY = 'jarvis.onboardingDone';

export class JarvisSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'jarvis.sidebarView';

  private _view?: vscode.WebviewView;
  private modelConfigManager: ModelConfigManager | null = null;
  private history: ChatMessage[] = [];

  private hitl = new HITLManager('moderate');
  private scrubber = new SecretScrubber();
  private checkpoints: CheckpointManager | null = null;
  private analytics: AnalyticsCollector | null = null;
  private tokenCounter = new TokenCounter();
  private responseCache = new ResponseCache();
  private indexer = new WorkspaceIndexer();
  private toolRegistry: ToolRegistry | null = null;
  private mcpManager: McpManager | null = null;
  private docsService: DocsService | null = null;
  private sessions: SessionStore | null = null;
  private changeTracker = new ChangeTracker();
  /** Approbations en attente (carte dans le chat), clé = id du prompt HITL. */
  private pendingApprovals = new Map<string, (d: ApprovalPromptDecision | null) => void>();
  private currentAbortController: AbortController | null = null;

  /** Notifie l'hôte (status bar) à chaque évolution des tokens. */
  public onTokensChanged: ((usage: TokenUsage) => void) | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    const mode = this.getOpt<string | undefined>(
      this.getOptimization().hitlMode,
      'hitl.mode',
      undefined
    );
    if (mode === 'strict' || mode === 'moderate' || mode === 'free') {
      this.hitl.setMode(mode);
    }

    this.changeTracker.onDidChange.event(() => {
      this.onChangesChanged?.();
      if (this._view) {
        this.notifyPendingChanges(this._view.webview);
      }
    });
  }

  /** Paramètres d'optimisation depuis la config Jarvis (source de vérité, spec §7). */
  private getOptimization(): NonNullable<JarvisConfig['optimization']> {
    try {
      return getConfigManager().getConfig().optimization ?? {};
    } catch {
      return {};
    }
  }

  /** Valeur de config Jarvis si définie, sinon fallback sur le setting VS Code. */
  private getOpt<T>(configValue: T | undefined, vsCodeKey: string, fallback: T): T {
    if (configValue !== undefined) return configValue;
    const value = vscode.workspace.getConfiguration('jarvis').get<T>(vsCodeKey);
    return value ?? fallback;
  }

  /** Bloc de rules utilisateur (onglet Settings), vide si aucune. */
  private getRulesText(): string {
    try {
      return renderRules(loadRules(getConfigManager().getConfig()));
    } catch {
      return '';
    }
  }

  /** Instructions du workspace actif (type CLAUDE.md), vide si aucun. */
  private getWorkspaceInstructionsText(): string {
    try {
      return renderWorkspaceInstructions(getActiveWorkspace(getConfigManager().getConfig()));
    } catch {
      return '';
    }
  }

  /** Consigne de verbosité injectée dans les prompts (vide en mode `normal`). */
  private getVerbosityInstruction(): string {
    switch (this.getOptimization().verbosity) {
      case 'concise':
        return 'STYLE DE RÉPONSE : sois bref et direct. Va à l\'essentiel, sans préambule ni récapitulatif superflu. Privilégie des phrases courtes et des listes.';
      case 'detailed':
        return 'STYLE DE RÉPONSE : sois détaillé et pédagogique. Explique ton raisonnement, donne du contexte et des exemples utiles.';
      default:
        return '';
    }
  }

  /** Rules + instructions du workspace actif + verbosité, pour les prompts système. */
  private getPromptExtras(): string {
    return [this.getRulesText(), this.getWorkspaceInstructionsText(), this.getVerbosityInstruction()]
      .filter(Boolean)
      .join('\n\n');
  }

  /** Prompt système du chat direct, rules + workspace inclus (spec §5.2). */
  private buildSystemPrompt(): string {
    const extras = this.getPromptExtras();
    return extras ? `${BASE_SYSTEM_PROMPT}\n\n${extras}` : BASE_SYSTEM_PROMPT;
  }

  private getMcpManager(): McpManager | null {
    if (this.mcpManager) return this.mcpManager;
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      this.mcpManager = new McpManager(undefined, undefined, workspaceFolder);
      return this.mcpManager;
    } catch (err) {
      console.warn('McpManager indisponible:', err);
      return null;
    }
  }

  private getDocsService(): DocsService {
    if (!this.docsService) this.docsService = new DocsService();
    return this.docsService;
  }

  /** Recherche @docs: fusionnée : .md du workspace + documentations en cache. */
  private async searchAllDocs(query: string): Promise<RagSearchResult[]> {
    const internal = await this.indexer.searchDocs(query);
    const external = await this.getDocsService().search(query);
    return mergeSearchResults(5, internal, external);
  }

  /**
   * Augmentation de contexte RAG (spec §5.2) : cherche dans l'index sémantique du
   * workspace des snippets de code potentiellement pertinents pour la tâche, et les
   * ajoute au prompt envoyé au modèle. N'affecte que le prompt de CET appel — le texte
   * inséré dans `this.history` par l'appelant reste non augmenté (pas de pollution de
   * l'historique persistant/affiché).
   */
  private async augmentTaskWithCodeContext(task: string): Promise<string> {
    if (this.indexer.index.size === 0 || task.trim().length < 20) return task;
    try {
      const results = await this.indexer.search(task, 3);
      const augmented = augmentWithCodeContext(task, results);
      if (augmented !== task) {
        operationLogger.log('rag', 'Contexte augmenté avec des snippets pertinents du projet.');
      }
      return augmented;
    } catch (err) {
      operationLogger.log('rag', `Augmentation de contexte échouée: ${err instanceof Error ? err.message : err}`, 'error');
      return task;
    }
  }

  private getConfiguredAgents() {
    try {
      return getAgents(getConfigManager().getConfig());
    } catch {
      return getAgents();
    }
  }

  private getConfiguredWorkflows() {
    try {
      return getWorkflows(getConfigManager().getConfig());
    } catch {
      return getWorkflows();
    }
  }

  private getConfiguredPrompts() {
    try {
      return loadPrompts(getConfigManager().getConfig());
    } catch {
      return [];
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      message => this.handleMessage(webviewView.webview, message),
      undefined,
      this.context.subscriptions
    );

    // Webview fermé : débloque les approbations en attente (fallback natif) et
    // détache le handler pour éviter de poster vers un webview mort.
    webviewView.onDidDispose(
      () => {
        for (const resolve of this.pendingApprovals.values()) resolve(null);
        this.pendingApprovals.clear();
        this.hitl.setPromptHandler(null);
      },
      undefined,
      this.context.subscriptions
    );
  }

  private post(webview: vscode.Webview, message: Record<string, unknown>): void {
    void webview.postMessage(message);
  }

  private async handleMessage(webview: vscode.Webview, message: Record<string, unknown>): Promise<void> {
    switch (message.type) {
      case 'webviewReady':
        this.onWebviewReady(webview);
        break;
      case 'chatMessage':
        if (typeof message.text === 'string') {
          const mode = typeof message.mode === 'string' ? message.mode : undefined;
          await this.onChatMessage(webview, message.text, mode);
        }
        break;
      case 'planProceed':
        // Lancer l'exécution du plan validé en mode automatique
        await this.onChatMessage(webview, "Le plan est validé. Procède à son implémentation étape par étape.", 'Automatic');
        break;
      case 'listCheckpoints':
        await this.onListCheckpoints(webview);
        break;
      case 'rollback':
        if (typeof message.ref === 'string') {
          await this.onRollback(webview, message.ref);
        }
        break;
      case 'getAnalytics':
        this.onGetAnalytics(webview);
        break;
      case 'exportAnalytics':
        await this.getAnalytics()?.export().catch(() => undefined);
        break;
      case 'setHitlMode':
        if (typeof message.mode === 'string') {
          this.hitl.setMode(message.mode as HITLMode);
          operationLogger.log('hitl', `Mode HITL: ${message.mode}`);
          // Persiste le mode pour qu'il survive au rechargement de la fenêtre.
          try {
            const cm = getConfigManager();
            const global = cm.getGlobalConfig();
            await cm.writeGlobal({
              ...global,
              optimization: { ...global.optimization, hitlMode: message.mode as HITLMode }
            });
          } catch {
            /* best-effort */
          }
        }
        break;
      case 'setModel':
        if (typeof message.model === 'string') {
          await this.onSetModel(webview, message.model);
        }
        break;
      case 'getSettings':
        await this.onGetSettings(webview);
        break;
      case 'openConfigFile':
        await this.onOpenConfigFile();
        break;
      case 'openUserGuide':
        await this.onOpenUserGuide();
        break;
      case 'updateSettings':
        if (message.config && typeof message.config === 'object') {
          await this.onUpdateSettings(webview, message.config as JarvisConfig);
        }
        break;
      case 'getMcpStatus':
        await this.onGetMcpStatus(webview);
        break;
      case 'indexDocs':
        if (typeof message.id === 'string') {
          await this.onIndexDocs(webview, message.id);
        }
        break;
      case 'getDocsStatus':
        await this.onGetDocsStatus(webview);
        break;
      case 'setActiveWorkspace':
        await this.onSetActiveWorkspace(webview, typeof message.id === 'string' ? message.id : null);
        break;
      case 'getIndexStatus':
        this.postIndexStatus(webview);
        break;
      case 'indexWorkspace':
        await this.indexWorkspaceInBackground(webview);
        break;
      case 'queryFiles':
        if (typeof message.query === 'string') {
          void this.onQueryFiles(webview, message.query);
        }
        break;
      case 'queryDocs':
        if (typeof message.query === 'string') {
          void this.onQueryDocs(webview, message.query);
        }
        break;
      case 'openFile':
        if (typeof message.path === 'string') {
          await this.onOpenFile(message.path);
        }
        break;
      case 'resolveHunk':
        await this.onResolveHunk(webview, message);
        break;
      case 'resolveFile':
        await this.onResolveFile(webview, message);
        break;
      case 'resolveAll':
        await this.onResolveAll(webview, message);
        break;
      case 'approvalResponse':
        this.onApprovalResponse(message);
        break;
      case 'cancelRequest':
        if (this.currentAbortController) {
          this.currentAbortController.abort();
          this.currentAbortController = null;
          this.post(webview, { type: 'chatError', error: "Génération annulée par l'utilisateur." });
        }
        break;
      case 'testConnection':
        if (message.model && typeof message.model === 'object') {
          await this.onTestConnection(webview, message.model as ModelItem);
        }
        break;
      case 'completeOnboarding':
        await this.context.globalState.update(ONBOARDING_DONE_KEY, true);
        this.post(webview, { type: 'onboardingState', done: true });
        operationLogger.log('config', 'Onboarding complété');
        break;
    }
  }

  /**
   * Test de connexion d'un provider pendant l'onboarding : envoie un prompt
   * minimal via un provider éphémère (aucune persistance de config).
   */
  private async onTestConnection(webview: vscode.Webview, item: ModelItem): Promise<void> {
    try {
      if (!item.provider || !item.model) {
        throw new Error('Provider et modèle requis');
      }
      const provider = createProviderFromItem(item);
      const res = await provider.sendPrompt(
        [{ role: 'user', content: 'ping' }],
        undefined,
        AbortSignal.timeout(20000)
      );
      const text = typeof res === 'string' ? res : res.text;
      this.post(webview, { type: 'connectionResult', ok: true, sample: (text ?? '').slice(0, 120) });
      operationLogger.log('config', `Test connexion OK (${item.provider}/${item.model})`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post(webview, { type: 'connectionResult', ok: false, error: msg });
      operationLogger.log('config', `Test connexion échoué (${item.provider}): ${msg}`, 'error');
    }
  }

  /** Résout la promesse d'approbation en attente avec la décision du chat. */
  private onApprovalResponse(message: Record<string, unknown>): void {
    const id = typeof message.id === 'string' ? message.id : '';
    const resolve = this.pendingApprovals.get(id);
    if (!resolve) return;
    this.pendingApprovals.delete(id);
    const raw = message.decision;
    const decision: ApprovalPromptDecision['decision'] =
      raw === 'allow' || raw === 'allow-session' ? raw : 'deny';
    resolve({
      decision,
      feedback: typeof message.feedback === 'string' ? message.feedback : undefined
    });
  }

  public getChangeTracker(): ChangeTracker {
    return this.changeTracker;
  }

  public onChangesChanged: (() => void) | null = null;

  public async resolveHunk(pathStr: string, hunkId: number, revision: number, action: 'accept' | 'reject'): Promise<void> {
    let rejectedDiff = '';
    if (action === 'reject') {
      const snap = this.changeTracker.snapshot().find(s => s.path === pathStr && s.revision === revision);
      const hunk = snap?.hunks.find(h => h.id === hunkId);
      if (hunk) {
        rejectedDiff = `\`\`\`diff\n`;
        for (const l of hunk.contextBefore) rejectedDiff += ` ${l}\n`;
        for (const l of hunk.beforeLines) rejectedDiff += `- ${l}\n`;
        for (const l of hunk.afterLines) rejectedDiff += `+ ${l}\n`;
        for (const l of hunk.contextAfter) rejectedDiff += ` ${l}\n`;
        rejectedDiff += `\`\`\``;
      }
    }

    const diskAction = this.changeTracker.resolveHunk(pathStr, hunkId, revision, action);
    if (diskAction) {
      await this.applyDiskAction(diskAction);
    }

    if (action === 'reject' && rejectedDiff && this._view?.webview) {
      const msg = `J'ai rejeté la modification suivante dans le fichier \`${pathStr}\` :\n${rejectedDiff}\n\nVeuillez proposer une alternative directement dans le chat (n'utilisez pas vos outils d'édition de fichiers).`;
      this.post(this._view.webview, { type: 'injectUserMessage', text: msg });
      await this.onChatMessage(this._view.webview, msg, 'Automatic');
    }
  }

  public async resolveFile(pathStr: string, action: 'accept' | 'reject'): Promise<void> {
    const diskAction = this.changeTracker.resolveFile(pathStr, action);
    if (diskAction) {
      await this.applyDiskAction(diskAction);
    }

    if (action === 'reject' && this._view?.webview) {
      const msg = `J'ai rejeté TOUTES les modifications dans le fichier \`${pathStr}\`. Veuillez proposer une alternative directement dans le chat (n'utilisez pas vos outils d'édition de fichiers).`;
      this.post(this._view.webview, { type: 'injectUserMessage', text: msg });
      await this.onChatMessage(this._view.webview, msg, 'Automatic');
    }
  }

  private async onResolveHunk(webview: vscode.Webview, message: Record<string, unknown>): Promise<void> {
    const { path: pathStr, hunkId, revision, action } = message as { path: string; hunkId: number; revision: number; action: 'accept' | 'reject' };
    await this.resolveHunk(pathStr, hunkId, revision, action);
  }

  private async onResolveFile(webview: vscode.Webview, message: Record<string, unknown>): Promise<void> {
    const { path: pathStr, action } = message as { path: string; action: 'accept' | 'reject' };
    await this.resolveFile(pathStr, action);
  }

  private async onOpenFile(filePathUri: string): Promise<void> {
    try {
      const cleanUri = filePathUri.startsWith('file://') ? filePathUri : 'file://' + filePathUri;
      const uri = vscode.Uri.parse(cleanUri);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      operationLogger.log('extension', `onOpenFile échoué: ${err instanceof Error ? err.message : err}`, 'error');
      vscode.window.showErrorMessage(`Jarvis: unable to open file — ${err instanceof Error ? err.message : err}`);
    }
  }

  private async onResolveAll(webview: vscode.Webview, message: Record<string, unknown>): Promise<void> {
    const { action } = message as { action: 'accept' | 'reject' };
    await this.resolveAllChanges(action);
  }

  /** Accepte/rejette toutes les modifications en attente (commandes + webview). */
  public async resolveAllChanges(action: 'accept' | 'reject'): Promise<void> {
    const diskActions = this.changeTracker.resolveAll(action);
    for (const d of diskActions) {
      await this.applyDiskAction(d);
    }

    if (action === 'reject' && diskActions.length > 0 && this._view?.webview) {
      const paths = diskActions.map(d => `\`${d.path}\``).join(', ');
      const msg = `J'ai rejeté TOUTES les modifications en attente dans les fichiers suivants : ${paths}. Veuillez proposer une alternative directement dans le chat (n'utilisez pas vos outils d'édition de fichiers).`;
      this.post(this._view.webview, { type: 'injectUserMessage', text: msg });
      await this.onChatMessage(this._view.webview, msg, 'Automatic');
    }
  }

  private async applyDiskAction(action: { path: string; content: string | null }): Promise<void> {
    await this.changeTracker.runUntracked(async () => {
      try {
        if (action.content === null) {
          if (fs.existsSync(action.path)) {
            await fs.promises.unlink(action.path);
          }
        } else {
          await fs.promises.writeFile(action.path, action.content, 'utf8');
        }
      } catch (err) {
        operationLogger.log('diff-review', `Erreur lors de l'application de l'action sur ${action.path}: ${String(err)}`, 'error');
      }
    });
  }

  private notifyPendingChanges(webview: vscode.Webview): void {
    this.post(webview, {
      type: 'pendingChanges',
      changes: this.changeTracker.snapshot()
    });
    this.onChangesChanged?.();
  }

  private async onQueryFiles(webview: vscode.Webview, query: string): Promise<void> {
    try {
      const q = query.trim().toLowerCase();
      const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 2000);
      const basePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
      const filePaths: string[] = [];
      for (const uri of uris) {
        let p = uri.fsPath;
        if (basePath && p.startsWith(basePath)) {
          p = p.substring(basePath.length + 1);
        }
        p = p.replace(/\\/g, '/');
        if (!q || p.toLowerCase().includes(q)) {
          filePaths.push(p);
        }
        if (filePaths.length >= 50) break;
      }
      this.post(webview, { type: 'fileSuggestions', files: filePaths });
    } catch {
      this.post(webview, { type: 'fileSuggestions', files: [] });
    }
  }

  /**
   * Suggestions pour la mention `@docs:` (spec Phase 4) : propose les sites de
   * documentation configurés et activés (Settings > Docs) — @docs: interroge les
   * sites crawlés, pas les fichiers du workspace (voir le texte de DocsSection.svelte).
   */
  private async onQueryDocs(webview: vscode.Webview, query: string): Promise<void> {
    try {
      const q = query.trim().toLowerCase();
      const sites = getConfigManager().getConfig().docs ?? [];
      const suggestions = sites
        .filter(site => site.enabled && (!q || site.title.toLowerCase().includes(q)))
        .map(site => site.title);

      this.post(webview, { type: 'docsSuggestions', docs: suggestions });
    } catch {
      this.post(webview, { type: 'docsSuggestions', docs: [] });
    }
  }

  private async onSetActiveWorkspace(webview: vscode.Webview, id: string | null): Promise<void> {
    try {
      const cm = getConfigManager();
      const global = cm.getGlobalConfig();
      await cm.writeGlobal({ ...global, activeWorkspaceId: id ?? undefined });
      operationLogger.log('workspace', `Workspace actif: ${id ?? 'aucun'}`);
    } catch (err) {
      operationLogger.log('workspace', `setActiveWorkspace échoué: ${err instanceof Error ? err.message : err}`, 'error');
    }
    this.postCapabilities(webview);
  }

  private postIndexStatus(webview: vscode.Webview): void {
    this.post(webview, {
      type: 'indexStatus',
      indexing: this.indexer.isIndexing,
      fileCount: this.indexer.fileCount
    });
  }

  private onWebviewReady(webview: vscode.Webview): void {
    // Délègue les confirmations HITL à la carte d'approbation dans le chat.
    // Retour `null` impossible ici (webview prêt) → jamais de dialogue natif.
    this.hitl.setPromptHandler(
      request =>
        new Promise<ApprovalPromptDecision | null>(resolve => {
          this.pendingApprovals.set(request.id, resolve);
          this.post(webview, {
            type: 'approvalRequest',
            id: request.id,
            actionType: request.actionType,
            description: request.description,
            detail: request.detail
          });
        })
    );

    const configManager = this.getModelConfigManager();
    const model = configManager?.getEffectiveModel() ?? null;
    const models = configManager?.getAvailableModels() ?? [];
    const needsSetup = !model || models.length === 0;
    this.tokenCounter.setLimit(model ? configManager?.getContextLength(model) ?? null : null);
    // Persistance de session : restaure la jauge de la dernière session (reload/redémarrage).
    this.tokenCounter.restore(this.context.workspaceState.get<TokenSnapshot>(TOKEN_STATE_KEY));

    this.post(webview, {
      type: 'status',
      text: needsSetup ? 'No model configured — open Settings' : `Connected — model: ${model}`,
      success: !needsSetup,
      needsSetup,
      models: models.map(m => m.name),
      model: model ?? ''
    });
    // Onboarding : l'App affiche l'écran de bienvenue si jamais complété OU si aucun modèle.
    this.post(webview, {
      type: 'onboardingState',
      done: this.context.globalState.get<boolean>(ONBOARDING_DONE_KEY, false)
    });
    this.postTokens(webview);
    this.rehydrateChatHistory(webview);
    this.postCapabilities(webview);
    // L'App a besoin de la config au démarrage (showThinking, docs, workspaces…).
    void this.onGetSettings(webview);

    // Ré-hydrate l'index des documentations depuis le cache disque.
    try {
      const docs = getConfigManager().getConfig().docs ?? [];
      void this.getDocsService().loadFromCache(docs.filter(d => d.enabled)).catch(() => undefined);
    } catch {
      /* best-effort */
    }

    // Background RAG indexing (spec §5.2)
    void this.indexWorkspaceInBackground(webview);
  }

  /** Listes dynamiques (agents, workflows, workspaces) pour le chat. */
  private postCapabilities(webview: vscode.Webview): void {
    let workspaces: Array<{ id: string; name: string }> = [];
    let activeWorkspaceId: string | null = null;
    try {
      const config = getConfigManager().getConfig();
      workspaces = (config.workspaces ?? []).filter(w => w.enabled).map(w => ({ id: w.id, name: w.name }));
      activeWorkspaceId = config.activeWorkspaceId ?? null;
    } catch {
      /* best-effort */
    }
    this.post(webview, {
      type: 'capabilities',
      agents: this.getConfiguredAgents().map(a => ({ mention: a.mention, label: a.label })),
      workflows: this.getConfiguredWorkflows().map(w => ({ id: w.id, label: w.label })),
      prompts: this.getConfiguredPrompts().map(p => ({
        name: normalizePromptName(p.name),
        description: p.description ?? ''
      })),
      workspaces,
      activeWorkspaceId
    });
  }

  /** Lance le crawl + indexation d'un site de docs, avec progression vers l'UI. */
  private async onIndexDocs(webview: vscode.Webview, id: string): Promise<void> {
    const site = (getConfigManager().getConfig().docs ?? []).find(d => d.id === id);
    if (!site) {
      this.post(webview, {
        type: 'docsStatus',
        sites: [{ id, state: 'error', pages: 0, error: 'Site not found in saved settings' }]
      });
      return;
    }
    this.post(webview, { type: 'docsStatus', sites: [{ id, state: 'indexing', pages: 0 }] });
    try {
      const { pages } = await this.getDocsService().indexSite(site, done => {
        if (done % 5 === 0) {
          this.post(webview, { type: 'docsStatus', sites: [{ id, state: 'indexing', pages: done }] });
        }
      });
      operationLogger.log('docs', `Site ${site.title || site.startUrl} indexé (${pages} pages)`, 'success');
      this.post(webview, {
        type: 'docsStatus',
        sites: [{ id, state: 'done', pages, indexedAt: new Date().toISOString() }]
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('docs', `Indexation docs échouée (${id}): ${msg}`, 'error');
      this.post(webview, { type: 'docsStatus', sites: [{ id, state: 'error', pages: 0, error: msg }] });
    }
  }

  private async onGetDocsStatus(webview: vscode.Webview): Promise<void> {
    try {
      const docs = getConfigManager().getConfig().docs ?? [];
      const statuses = await this.getDocsService().getSiteStatuses(docs);
      this.post(webview, {
        type: 'docsStatus',
        sites: statuses.map(s => ({ id: s.id, state: 'idle', pages: s.pages, indexedAt: s.indexedAt }))
      });
    } catch {
      this.post(webview, { type: 'docsStatus', sites: [] });
    }
  }

  private async onGetMcpStatus(webview: vscode.Webview): Promise<void> {
    const mcp = this.getMcpManager();
    if (!mcp) {
      this.post(webview, { type: 'mcpStatus', servers: [] });
      return;
    }
    await mcp.initialize().catch(() => undefined);
    this.post(webview, { type: 'mcpStatus', servers: mcp.getStatuses() });
  }

  private postTokens(webview: vscode.Webview): void {
    const usage = this.tokenCounter.getUsage();
    
    const extras = this.getPromptExtras();
    const systemPrompt = extras ? `${BASE_SYSTEM_PROMPT}\n\n${extras}` : BASE_SYSTEM_PROMPT;
    const contextStr = systemPrompt + '\n' + this.history.map(m => `${m.role}: ${m.content}`).join('\n');
    const contextSize = estimateTokens(contextStr);

    this.post(webview, {
      type: 'tokens',
      usage,
      tokensUsed: contextSize,
      tokensLimit: usage.limit
    });
    this.onTokensChanged?.(usage);
  }

  private recordRequest(webview: vscode.Webview, model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): void {
    this.tokenCounter.addRequest(model, inputTokens, outputTokens, cachedTokens);
    this.persistTokenState();
    this.postTokens(webview);
  }

  /** Sauvegarde l'instantané de la jauge (survit reload + redémarrage). */
  private persistTokenState(): void {
    void this.context.workspaceState.update(TOKEN_STATE_KEY, this.tokenCounter.serialize());
  }

  /**
   * Re-remplit le chat de la webview avec la session courante après un reload
   * (l'historique vit sur disque via SessionStore mais la webview repart vide).
   * No-op si le backend a déjà un historique en mémoire (webview seulement masquée).
   */
  private rehydrateChatHistory(webview: vscode.Webview): void {
    if (this.history.length > 0) return;
    const current = this.getSessions()?.getCurrent();
    const stored = current?.messages ?? [];
    if (stored.length === 0) return;
    // Restaure le contexte backend pour que la discussion continue de façon cohérente.
    this.history = stored.map(m => ({ role: m.role, content: m.content }));
    const display = stored
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0)
      .map(m => ({ role: m.role, content: m.content }));
    if (display.length > 0) {
      this.post(webview, { type: 'chatHistory', messages: display });
    }
  }

  private async onSetModel(webview: vscode.Webview, model: string): Promise<void> {
    const configManager = this.getModelConfigManager();
    if (!configManager) return;
    await configManager.setDefaultModel(model);
    this.tokenCounter.setLimit(configManager.getContextLength(model));
    operationLogger.log('config', `Default model: ${model}`);
    this.post(webview, {
      type: 'status',
      text: `Connected — model: ${model}`,
      success: true,
      needsSetup: false,
      model
    });
    this.postTokens(webview);
  }

  // (Supprimé car implémenté plus bas avec la logique MCP complète)

  /** Ouvre la config globale (~/.jarvis/config.json) dans l'éditeur. */
  private async onOpenConfigFile(): Promise<void> {
    try {
      // loadSync a créé le fichier au premier lancement ; l'ouvrir directement.
      const uri = vscode.Uri.file(getConfigManager().getGlobalConfigPath());
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('config', `openConfigFile échoué: ${msg}`, 'error');
      vscode.window.showErrorMessage(`Jarvis: unable to open config — ${msg}`);
    }
  }

  /** Ouvre le README.md en aperçu (User Guide). */
  private async onOpenUserGuide(): Promise<void> {
    try {
      const uri = vscode.Uri.file(path.join(this.context.extensionPath, 'README.md'));
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('extension', `openUserGuide échoué: ${msg}`, 'error');
      vscode.window.showErrorMessage(`Jarvis: unable to open guide — ${msg}`);
    }
  }

  /** Envoie la config globale brute au webview pour édition dans l'onglet Settings. */
  private async onGetSettings(webview: vscode.Webview): Promise<void> {
    let config: JarvisConfig;
    let needsSetup = true;
    try {
      config = getConfigManager().getGlobalConfig();
      needsSetup = config.models.items.length === 0;
    } catch (err) {
      operationLogger.log('config', `getSettings échoué: ${err instanceof Error ? err.message : err}`, 'error');
      config = normalizeConfig(null);
    }
    this.post(webview, {
      type: 'settings',
      config,
      needsSetup,
      defaults: await this.getSettingsDefaults(),
      currentFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
    });
  }

  /** Persiste la config éditée (scope global) puis ré-instancie providers + status. */
  private async onUpdateSettings(webview: vscode.Webview, incoming: JarvisConfig): Promise<void> {
    try {
      const previousDocs = getConfigManager().getGlobalConfig().docs ?? [];
      const config = normalizeConfig(incoming);
      await getConfigManager().writeGlobal(config);
      void this.syncDocsWithConfig(previousDocs, config.docs ?? []).catch(() => undefined);
      const configManager = this.getModelConfigManager();
      configManager?.refresh();
      this.toolRegistry = null; // sera reconstruit avec les tools MCP à jour
      await this.mcpManager?.reload().catch(() => undefined);
      this.postCapabilities(webview);
      // Applique le mode HITL en live (sinon effectif seulement après reload).
      const hitlMode = config.optimization?.hitlMode;
      if (hitlMode) this.hitl.setMode(hitlMode);
      const model = configManager?.getEffectiveModel() ?? null;
      this.tokenCounter.setLimit(model ? configManager?.getContextLength(model) ?? null : null);
      operationLogger.log('config', 'Settings updated', 'success');
      this.post(webview, { type: 'settingsSaved', ok: true });
      this.post(webview, {
        type: 'settings',
        config,
        needsSetup: !model,
        defaults: await this.getSettingsDefaults(),
        currentFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
      });
      const models = configManager?.getAvailableModels() ?? [];
      this.post(webview, {
        type: 'status',
        text: model ? `Connected — model: ${model}` : 'No model configured — open Settings',
        success: !!model,
        needsSetup: !model,
        models: models.map(m => m.name),
        model: model ?? ''
      });
      this.postTokens(webview);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('config', `updateSettings échoué: ${msg}`, 'error');
      this.post(webview, { type: 'settingsSaved', ok: false, error: msg });
    }
  }

  /** Applique le diff des sites docs après sauvegarde : purge supprimés/désactivés, charge les activés. */
  private async syncDocsWithConfig(previous: DocSite[], next: DocSite[]): Promise<void> {
    const docsService = this.getDocsService();
    const nextById = new Map(next.map(d => [d.id, d]));
    for (const old of previous) {
      const current = nextById.get(old.id);
      if (!current) {
        await docsService.removeSite(old.id).catch(() => undefined);
      } else if (!current.enabled && old.enabled) {
        docsService.unloadSite(old.id);
      }
    }
    await docsService.loadFromCache(next.filter(d => d.enabled)).catch(() => undefined);
  }

  private async indexWorkspaceInBackground(webview?: vscode.Webview): Promise<void> {
    if (this.indexer.isIndexing) return;
    if (webview) {
      this.post(webview, { type: 'indexStatus', indexing: true, fileCount: this.indexer.fileCount });
    }
    try {
      const count = await this.indexer.indexWorkspace();
      operationLogger.log('rag', `Indexation terminée: ${count} fichiers`, 'success');
    } catch (err) {
      operationLogger.log('rag', `Indexation échouée: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      if (webview) this.postIndexStatus(webview);
    }
  }

  private getActiveProvider(): { provider: IModelProvider; providerName: string; model: string } | null {
    const configManager = this.getModelConfigManager();
    if (!configManager) return null;
    const model = configManager.getEffectiveModel();
    if (!model) return null;
    // Un provider est instancié par modèle (schéma centré modèle).
    const provider = configManager.getProvider(model);
    if (!provider) return null;
    const providerName = configManager.getProviderNameForModel(model) ?? 'openai-compatible';
    return { provider, providerName, model };
  }

  /** Scrubbing des secrets — toujours activé pour les providers cloud (spec §6.1). */
  private maybeScrub(text: string, providerName: string): string {
    const configManager = this.getModelConfigManager();
    if (!configManager?.isCloudProvider(providerName)) return text;
    const { cleaned, foundSecrets } = this.scrubber.scrub(text);
    if (foundSecrets.length > 0) {
      operationLogger.log('scrubbing', `${foundSecrets.length} secret(s) masqué(s) avant envoi cloud`, 'blocked');
    }
    return cleaned;
  }

  private async getSettingsDefaults(): Promise<Record<string, unknown>> {
    const config = getConfigManager().getConfig();
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    let customTools: Array<{ name: string; description: string }> = [];
    if (workspaceFolder) {
      try {
        customTools = (await loadCustomTools(workspaceFolder)).map(t => ({
          name: t.name,
          description: t.description
        }));
      } catch {
        /* best-effort */
      }
    }
    
    // Activer MCP pour filtrer les builtins
    const mcp = this.getMcpManager();
    let activeMcpTools = new Map<string, Set<string>>();
    if (mcp) {
      await mcp.initialize().catch(() => undefined);
      activeMcpTools = mcp.activeToolNames();
    }

    const availableTools = createBuiltinTools()
      .filter(t => !isBuiltinShadowed(t.name, activeMcpTools))
      .map(t => ({ name: t.name, description: t.description }));

    return {
      optimization: {
        chatMode: 'agent',
        ...config.optimization
      },
      agentTools: availableTools,
      docs: config.docs ?? [],
      mcpServers: config.mcpServers ?? {},
      builtinMcp: getBuiltinMcpServers(workspaceFolder).map(b => ({
        id: b.id,
        label: b.label,
        description: b.description,
        command: builtinCommandString(b),
        defaultEnabled: b.config.enabled
      })),
      customTools,
      agents: getAgents(),
      workflows: getWorkflows()
    };
  }

  private async runPlanMode(webview: vscode.Webview, active: { provider: IModelProvider; providerName: string; model: string }, expanded: string): Promise<void> {
    operationLogger.log('chat', 'Mode Plan : Génération du implementation_plan.md');
    const planSystemPrompt = "RÈGLE SPECIALE MODE PLAN: Tu es en mode Plan. Rédige et mets à jour le plan d'implémentation détaillé directement dans ta réponse en Markdown. Ne crée AUCUN fichier physique sur le disque. Ton unique but est de répondre avec le plan complet formaté en Markdown.";
    
    let finalPrompt = expanded;
    const lastAssistantMsg = [...this.history].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg) {
      finalPrompt = `Voici le plan d'implémentation actuel :\n\n${lastAssistantMsg.content}\n\nConsigne de modification :\n${expanded}\n\nRefais le plan complètement en appliquant ces consignes.`;
    }

    const planText = await this.runAgent(webview, active, finalPrompt, planSystemPrompt, undefined, { kind: 'plan' });
    if (planText) this.history.push({ role: 'assistant', content: planText });
    this.getSessions()?.updateCurrent(this.history);
  }

  private async onChatMessage(webview: vscode.Webview, rawText: string, mode: string = 'Automatic'): Promise<void> {
    operationLogger.log('chat', `Message reçu [mode: ${mode}] : ${rawText.slice(0, 80)}`);

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    const active = this.getActiveProvider();
    if (!active) {
      this.post(webview, {
        type: 'chatError',
        error: 'No model configured. Open Settings to add a provider and API key.',
        needsSetup: true
      });
      return;
    }
    const isSmallModel = active.providerName === 'ollama' || 
      active.providerName === 'lmstudio' || 
      active.model.toLowerCase().includes('7b') || 
      active.model.toLowerCase().includes('8b');

    if (isSmallModel && mode !== 'Fast') {
      mode = 'Fast';
      this.post(webview, { type: 'chatChunk', text: "\n\n*(Petit modèle détecté : Bascule automatique en mode Rapide)*\n\n" });
      operationLogger.log('chat', `Petit modèle détecté (${active.model}), routage forcé vers mode Fast`);
    }

    // Commandes outils déterministes (@read, @list, @write, @run)
    if (/^@(read|list|write|run)\b/.test(rawText)) {
      await this.handleToolCommand(webview, rawText);
      return;
    }

    if (/^\/new\b/.test(rawText)) {
      this.startNewSession(webview);
      this.post(webview, { type: 'chatDone' });
      return;
    }

    const resumeMatch = rawText.match(/^\/resume(?:\s+(\S+))?\s*$/);
    if (resumeMatch) {
      await this.onResumeCommand(webview, resumeMatch[1]);
      this.post(webview, { type: 'chatDone' });
      return;
    }

    // Prompts enregistrés : `/nom args` → contenu du prompt + args
    // (les commandes réservées /tdd, /workflow, /agent ne sont jamais masquées).
    if (rawText.startsWith('/')) {
      const expandedPrompt = expandPrompt(rawText, this.getConfiguredPrompts());
      if (expandedPrompt !== null) rawText = expandedPrompt;
    }

    // Expansion des mentions @file: / @docs: (spec Phase 4)
    const { expanded } = await expandMentions(rawText, {
      readFile: p => readFileTool(p),
      searchDocs: q => this.searchAllDocs(q)
    });



    // Boucle Auto-TDD (spec §3.3)
    if (rawText.startsWith('/tdd ')) {
      await this.runTDD(webview, active, expanded.replace(/^\/tdd\s+/, ''));
      return;
    }

    // Workflows prédéfinis (spec §5.2)
    const workflowMatch = rawText.match(/^\/workflow\s+(\S+)\s*([\s\S]*)$/);
    if (workflowMatch) {
      await this.runWorkflow(webview, active, workflowMatch[1], workflowMatch[2] || expanded);
      return;
    }

    // Mode agentique explicite
    if (rawText.startsWith('/agent ')) {
      await this.runAgent(webview, active, expanded.replace(/^\/agent\s+/, ''));
      return;
    }

    // Agents spécialisés via mention @QA-Agent etc. (spec §5.1)
    const mention = detectAgentMention(rawText, this.getConfiguredAgents());
    if (mention) {
      const { expanded: task } = await expandMentions(mention.task, {
        readFile: p => readFileTool(p),
        searchDocs: q => this.searchAllDocs(q)
      });
      await this.runAgent(webview, active, task, mention.agent.systemPrompt);
      return;
    }

    // Mode Plan : Workflow strict (Analyses, Plan, Validation, Implémentation)
    if (mode === 'Plan') {
      await this.runPlanMode(webview, active, expanded);
      return;
    }

    // Mode Rapide : Chat direct sans outils, réponse immédiate en texte
    if (mode === 'Fast') {
      operationLogger.log('chat', 'Mode Rapide : bascule vers streamChat sans outils');
      await this.streamChat(webview, active, expanded, rawText);
      return;
    }

    // === ROUTEUR AUTOMATIQUE ===
    // Vérification en amont si la question nécessite des outils (seulement en mode Automatic)
    if (mode === 'Automatic') {
      try {
        const routerPrompt = [
          { role: 'system' as const, content: 'Tu es un classifieur d\'intention. Réfléchis à voix haute en une phrase courte, puis termine obligatoirement ta réponse par le mot exact "[TOOLS]", "[CHAT]" ou "[PLAN]".\n"[CHAT]" si c\'est une salutation simple, une question théorique sans action requise (ex: "qui es-tu ?", "comment fonctionne React ?").\n"[TOOLS]" si l\'utilisateur demande une action technique modérée, ponctuelle, ou l\'édition de 1 à 3 fichiers (ex: "crée un composant bouton", "corrige ce bug").\n"[PLAN]" si la tâche est vaste, architecturale, ou implique la création/modification de nombreux fichiers ou d\'un projet entier (ex: "crée une API Express complète", "migre ce projet en TypeScript").' },
          { role: 'user' as const, content: expanded }
        ];
        
        this.post(webview, { type: 'chatStart' });
        this.post(webview, { type: 'agentThinking', text: '' });
        
        let decisionRaw = '';
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(new Error("Timeout du routeur (30s)")), 30000);

        try {
          if (active.provider.sendPromptStream) {
            await active.provider.sendPromptStream(
              routerPrompt,
              chunk => {
                decisionRaw += chunk;
                this.post(webview, { type: 'agentThinkingChunk', chunk });
              },
              () => {},
              err => { throw err; },
              undefined,
              abortController.signal
            );
          } else {
            const res = await active.provider.sendPrompt(routerPrompt, undefined, abortController.signal);
            decisionRaw = typeof res === 'string' ? res : res.text;
            this.post(webview, { type: 'agentThinkingChunk', chunk: decisionRaw });
          }
        } finally {
          clearTimeout(timeout);
        }
        
        this.post(webview, { type: 'chatDone' });
        
        const decisionUpper = decisionRaw.toUpperCase();
        if (decisionUpper.includes('[CHAT]') && !decisionUpper.includes('[TOOLS]') && !decisionUpper.includes('[PLAN]')) {
          operationLogger.log('chat', 'Routage: Intention conversationnelle détectée -> bascule en mode sans outils');
          await this.streamChat(webview, active, expanded, rawText);
          return;
        }
        if (decisionUpper.includes('[PLAN]')) {
          operationLogger.log('chat', 'Routage: Tâche vaste détectée -> bascule dynamique en mode Plan');
          await this.runPlanMode(webview, active, expanded);
          return;
        }
      } catch (e) {
        this.post(webview, { type: 'chatChunk', text: `\n*(Erreur du routeur: ${e instanceof Error ? e.message : e} - Fallback sur les outils)*` });
        this.post(webview, { type: 'chatDone' });
        operationLogger.log('chat', `Erreur du routeur, fallback sur les outils: ${e}`);
      }
    }

    // Par défaut le chat est agentique : le modèle dispose de ses outils
    // (création/édition de fichiers, terminal…) au lieu de répondre en texte.
    const chatMode = this.getOptimization().chatMode ?? 'agent';
    if (chatMode === 'agent' || mode === 'Automatic') {
      const recentHistory = this.history.slice(-10);
      const finalText = await this.runAgent(webview, active, expanded, undefined, recentHistory);
      this.history.push({ role: 'user', content: this.maybeScrub(expanded, active.providerName) });
      if (finalText) this.history.push({ role: 'assistant', content: finalText });
      this.getSessions()?.updateCurrent(this.history);
      return;
    }

    await this.streamChat(webview, active, expanded, rawText);
  }

  private startNewSession(webview: vscode.Webview): void {
    const store = this.getSessions();
    store?.startNew();
    this.history = [];
    this.tokenCounter.reset();
    this.persistTokenState();
    this.postTokens(webview);
    this.post(webview, { type: 'sessionStarted' });
    operationLogger.log('session', 'Nouvelle session de discussion démarrée');
  }

  private onListSessions(webview: vscode.Webview): void {
    const store = this.getSessions();
    this.post(webview, { type: 'sessions', sessions: store?.list() ?? [] });
  }

  private async onResumeCommand(webview: vscode.Webview, arg?: string): Promise<void> {
    const store = this.getSessions();
    if (!store) return;
    
    const list = store.list();
    if (list.length === 0) {
      vscode.window.showInformationMessage("Jarvis: No previous discussion found.");
      return;
    }

    if (!arg) {
      const items = list.map((s, i) => ({
        label: `[${i + 1}] ${s.title || '(untitled)'}`,
        description: `${s.messageCount} messages`,
        detail: new Date(s.updatedAt).toLocaleString(),
        session: s
      }));
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Sélectionnez une discussion à reprendre'
      });
      if (picked) {
        this.resumeSession(webview, picked.session.id);
      }
      return;
    }

    const index = parseInt(arg, 10);
    let session = store.getById(arg);
    if (!session && !isNaN(index) && index >= 1 && index <= list.length) {
      session = store.getById(list[index - 1].id);
    }
    if (session) {
      this.resumeSession(webview, session.id);
    } else {
      this.post(webview, { type: 'chatError', error: `Session introuvable : ${arg}` });
    }
  }

  private resumeSession(webview: vscode.Webview, id: string): void {
    const store = this.getSessions();
    if (!store) return;
    const session = store.getById(id);
    if (!session) return;
    const ctx = buildResumeContext(session);
    store.startNew(`Resumed: ${session.title}`);
    store.updateCurrent([ctx]);
    this.history = [ctx];
    this.tokenCounter.reset();
    this.persistTokenState();
    this.postTokens(webview);
    this.post(webview, { type: 'sessionResumed', title: session.title });
    operationLogger.log('session', `Session reprise: ${session.title}`);
  }

  /** Chat direct avec streaming (spec §3.2) + cache des réponses. */
  private async streamChat(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    expandedText: string,
    rawText: string
  ): Promise<void> {
    const { provider, providerName, model } = active;
    const outgoing = this.maybeScrub(expandedText, providerName);

    this.history.push({ role: 'user', content: outgoing });
    const messages: ChatMessage[] = [{ role: 'system', content: this.buildSystemPrompt() }, ...this.history];
    const inputTokens = estimateTokens(messages.map(m => m.content).join(' '));

    // Cache des réponses (spec §3.2)
    const cacheKey = ResponseCache.keyFor(model, messages);
    const cached = this.responseCache.get(cacheKey);
    if (cached) {
      this.history.push({ role: 'assistant', content: cached });
      this.post(webview, { type: 'chatStart' });
      this.post(webview, { type: 'chatChunk', text: cached });
      this.post(webview, { type: 'chatDone' });
      operationLogger.log('chat', 'Réponse servie depuis le cache', 'success');
      return;
    }

    let assembled = '';
    const started = Date.now();
    this.post(webview, { type: 'chatStart' });

    // Suggestion d'agent spécialisé (spec §5.1 — auto-détection)
    const suggestion = suggestAgent(rawText, this.getConfiguredAgents());
    if (suggestion) {
      this.post(webview, {
        type: 'chatChunk',
        text: `> 💡 *Astuce: ${suggestion.mention} (${suggestion.label}) pourrait aider — mentionnez-le pour l'activer.*\n\n`
      });
    }

    this.currentAbortController = new AbortController();
    try {
      await provider.sendPromptStream(
        messages,
        chunk => {
          assembled += chunk;
          this.post(webview, { type: 'chatChunk', text: chunk });
        },
        (_toolCalls, usage) => {
        this.history.push({ role: 'assistant', content: assembled });
        this.getSessions()?.updateCurrent(this.history);
        this.responseCache.set(cacheKey, assembled);
        const outputTokens = estimateTokens(assembled);
        this.recordRequest(webview, model, inputTokens, outputTokens, usage?.cachedTokens ?? 0);
        this.post(webview, { type: 'chatDone' });
        operationLogger.log('chat', `Réponse du modèle ${model} (${outputTokens} tokens)`, 'success');
        this.getAnalytics()?.trackAction({
          type: 'chat',
          model,
          inputTokens,
          outputTokens,
          duration: (Date.now() - started) / 1000,
          status: 'success'
        });
      },
      err => {
        const isAbort = err.name === 'AbortError' || err.message.includes('aborted');
        if (!isAbort) {
          this.post(webview, { type: 'chatError', error: err.message });
        }
        operationLogger.log('chat', `Erreur du modèle: ${err.message}`, 'error');
        this.getAnalytics()?.trackAction({
          type: 'chat',
          model,
          inputTokens,
          outputTokens: 0,
          duration: (Date.now() - started) / 1000,
          status: 'error'
        });
      },
      undefined,
      this.currentAbortController.signal
    );
    } finally {
      this.currentAbortController = null;
    }
  }

  /** Politique par outil (Settings > Tools) — `{}` si config illisible. */
  private getToolPolicies(): Record<string, ToolPolicy> {
    try {
      return getConfigManager().getConfig().toolPolicies ?? {};
    } catch {
      return {};
    }
  }

  /** Tools MCP actifs par serveur connecté — connecte les serveurs si besoin. */
  private async getActiveMcpTools(): Promise<ActiveMcpTools> {
    const mcp = this.getMcpManager();
    if (!mcp) return new Map();
    await mcp.initialize().catch(() => undefined);
    return mcp.activeToolNames();
  }

  private async getToolRegistry(): Promise<ToolRegistry> {
    if (this.toolRegistry) return this.toolRegistry;
    const policies = this.getToolPolicies();
    const registry = new ToolRegistry();
    
    // MCP d'abord : les builtins doublonnés par un serveur connecté sont masqués.
    const activeMcpTools = await this.getActiveMcpTools();
    for (const tool of createBuiltinTools()) {
      if (policies[tool.name] === 'excluded') continue;
      if (isBuiltinShadowed(tool.name, activeMcpTools)) continue;
      registry.register(tool);
    }
    
    // Outils personnalisés depuis jarvis-tools/ (spec §5.1)
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      for (const tool of await loadCustomTools(workspaceFolder)) {
        if (policies[tool.name] === 'excluded') continue;
        registry.register(tool);
        operationLogger.log('tools', `Outil personnalisé chargé: ${tool.name}`);
      }
    }
    
    // Tools des serveurs MCP configurés (onglet Settings)
    const mcp = this.getMcpManager();
    if (mcp) {
      for (const tool of mcp.toToolDefinitions()) {
        registry.register(tool);
      }
    }
    
    this.toolRegistry = registry;
    return registry;
  }

  private agentEvents(webview: vscode.Webview): AgentEvents {
    return {
      onThinking: text => this.post(webview, { type: 'agentThinking', text }),
      onThinkingChunk: chunk => this.post(webview, { type: 'agentThinkingChunk', chunk }),
      onToolCall: (tool, args) => {
        operationLogger.log('tool-call', `${tool} ${JSON.stringify(args)}`);
        this.post(webview, { type: 'agentTool', tool, args });
      },
      onToolResult: (tool, result, success, args) => {
        operationLogger.log('tool-result', `${tool}: ${success ? 'ok' : 'échec'}`, success ? 'success' : 'error');
        
        let summary = result.length > 800 ? result.slice(0, 800) + '…' : result;
        if (success && args && typeof args === 'object') {
          const possiblePath = args.path ?? args.file ?? args.TargetFile ?? args.AbsolutePath;
          if (possiblePath && typeof possiblePath === 'string') {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const absolutePath = path.isAbsolute(possiblePath)
              ? possiblePath
              : workspaceFolder
                ? path.resolve(workspaceFolder, possiblePath)
                : possiblePath;
            const relativePath = workspaceFolder
              ? path.relative(workspaceFolder, absolutePath).replace(/\\/g, '/')
              : possiblePath;
            
            const fileView = this.changeTracker.snapshot().find(
              f => vscode.Uri.file(f.path).fsPath === vscode.Uri.file(absolutePath).fsPath || f.path === relativePath
            );
            if (fileView) {
              const added = fileView.hunks.reduce((sum, h) => sum + h.afterLines.length, 0);
              const deleted = fileView.hunks.reduce((sum, h) => sum + h.beforeLines.length, 0);
              const fileUri = vscode.Uri.file(absolutePath).toString();
              const actionVerb = fileView.isNew ? 'Created' : 'Edited';
              summary = `${actionVerb} [${relativePath}](${fileUri}) +${added} -${deleted}`;
            }
          }
        }

        this.post(webview, {
          type: 'agentToolResult',
          tool,
          success,
          summary
        });
        // Notifier le webview des changements en attente après chaque outil
        if (this.changeTracker.pendingCount > 0) {
          this.notifyPendingChanges(webview);
        }
      },
      onFinal: text => this.post(webview, { type: 'agentFinalChunk', chunk: text }),
      onFinalChunk: chunk => this.post(webview, { type: 'agentFinalChunk', chunk })
    };
  }

  private buildOrchestrator(
    active: { provider: IModelProvider; providerName: string },
    registry: ToolRegistry,
    persona?: string
  ): AgentOrchestrator {
    const maxIterations = this.getOpt(this.getOptimization().agentMaxIterations, 'agent.maxIterations', 100);
    return new AgentOrchestrator(active.provider, registry, {
      maxIterations,
      hitl: this.hitl,
      scrub: text => this.maybeScrub(text, active.providerName),
      systemPrompt: buildAgentSystemPrompt(registry, persona, this.getPromptExtras() || undefined),
      changeTracker: this.changeTracker,
      toolPolicies: this.getToolPolicies(),
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      abortSignal: this.currentAbortController?.signal
    });
  }

  /** Boucle agentique complète (spec §4). */
  private async runAgent(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    task: string,
    persona?: string,
    history?: ChatMessage[],
    options: { kind?: import('../../frontend/shared/types.js').MessageKind, isSmallModel?: boolean } = {}
  ): Promise<string | void> {
    this.post(webview, { type: 'chatStart' });
    this.currentAbortController = new AbortController();

    // Assure que le fichier .jarvisignore est généré au plus tôt dans l'espace de travail via l'API asynchrone VS Code
    try { await new SandboxManager().ensureIgnoreFile(); } catch { /* ignore */ }

    // Augmentation de contexte RAG (spec §5.2) : snippets de code pertinents ajoutés au prompt.
    task = await this.augmentTaskWithCodeContext(task);

    let result;
    const started = Date.now();
    let inputTokens = estimateTokens(task);

    try {
      const baseRegistry = await this.getToolRegistry();
      const registry = baseRegistry.clone();
      
      if (options.isSmallModel) {
        operationLogger.log('agent', 'Petit modèle détecté : restriction des outils aux fichiers essentiels.');
        registry.restrictTo([
          'create_new_file', 
          'edit_existing_file', 
          'single_find_and_replace', 
          'read_file',
          'run_terminal_command'
        ]);
      }

      const orchestrator = this.buildOrchestrator(active, registry, persona);

      // Checkpoint avant action agentique (spec §6.2)
      await this.getCheckpoints().createCheckpoint('action', task.slice(0, 40)).catch(() => null);

      result = await orchestrator.run(task, history || [], this.agentEvents(webview));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = msg.includes('aborted');
      result = { 
        success: false, 
        finalText: '', 
        iterations: 0, 
        error: isAbort ? "Génération annulée par l'utilisateur." : `Erreur interne: ${msg}` 
      };
    } finally {
      this.currentAbortController = null;
    }

    const finalInputTokens = result.usage?.promptTokens || inputTokens;
    const finalOutputTokens = result.usage?.completionTokens || estimateTokens(result.finalText);
    this.recordRequest(webview, active.model, finalInputTokens, finalOutputTokens, result.usage?.cachedTokens ?? 0);

    this.getAnalytics()?.trackAction({
      type: 'agent',
      model: active.model,
      inputTokens: finalInputTokens,
      outputTokens: finalOutputTokens,
      duration: (Date.now() - started) / 1000,
      status: result.success ? 'success' : 'error'
    });

    if (!result.success) {
      const isAbort = result.error?.includes("annulée par l'utilisateur");
      if (!isAbort) {
        this.post(webview, { type: 'chatError', error: result.error ?? 'Échec de l\'agent' });
      }
      return;
    }

    this.post(webview, {
      type: 'agentFinal',
      text: '', // Déjà streamé via onFinal Chunk
      kind: options?.kind,
      badges: [{ icon: '✅', label: `Terminé en ${result.iterations} itération(s)`, variant: 'success' }]
    });
    this.notifyPendingChanges(webview);
    this.post(webview, { type: 'chatDone' });

    return result.finalText;
  }

  /** Boucle Auto-TDD (spec §3.3). */
  private async runTDD(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    task: string
  ): Promise<void> {
    const opt = this.getOptimization();
    const maxAttempts = this.getOpt(opt.tddMaxAttempts, 'tdd.maxAttempts', 5);
    const testCommand = this.getOpt(opt.tddTestCommand, 'tdd.testCommand', 'npm test');
    const timeout = this.getOpt(opt.terminalTimeout, 'terminal.timeout', 30000);

    await this.getCheckpoints().createCheckpoint('workflow', `tdd-${task.slice(0, 30)}`).catch(() => null);

    const loop = new AutoTDDLoop(active.provider, {
      writeFile: async (p, content) => {
        const approval = await this.hitl.checkApproval('write_file', { path: p });
        if (!approval.granted) throw new Error(`Écriture refusée: ${p}`);
        await writeFileTool(p, content);
      },
      runCommand: async (command, t) => {
        const approval = await this.hitl.checkApproval('terminal', { command });
        if (!approval.granted) {
          return { success: false, stdout: '', stderr: 'Commande refusée par l\'utilisateur', timedOut: false };
        }
        const result = await executeTerminalCommand(command, { timeout: t });
        return { success: result.success, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut };
      }
    });

    const started = Date.now();
    const result = await loop.run(task, { maxAttempts, testCommand, timeout }, {
      onAttemptStart: (attempt, max) =>
        this.post(webview, { type: 'workflowStep', step: `Tentative TDD ${attempt}`, index: attempt, total: max }),
      onFilesGenerated: files =>
        this.post(webview, {
          type: 'agentTool',
          tool: 'create_new_file',
          args: { files: files.map(f => f.path) }
        }),
      onTestResult: (testResult, attempt) =>
        this.post(webview, {
          type: 'agentToolResult',
          tool: `tests (tentative ${attempt})`,
          success: testResult.success,
          summary: (testResult.stdout + testResult.stderr).slice(-800)
        })
    });

    this.recordRequest(webview, active.model, estimateTokens(task), estimateTokens(result.lastTestOutput));
    this.getAnalytics()?.trackAction({
      type: 'tdd',
      model: active.model,
      inputTokens: estimateTokens(task),
      outputTokens: estimateTokens(result.lastTestOutput),
      duration: (Date.now() - started) / 1000,
      status: result.success ? 'success' : 'error'
    });

    const summary = result.success
      ? `✅ **Auto-TDD réussi** en ${result.attempts} tentative(s).\n\nFichiers modifiés:\n${result.filesWritten.map(f => `- \`${f}\``).join('\n')}\n\n${result.explanation ?? ''}`
      : `❌ **Auto-TDD échoué** après ${result.attempts} tentative(s): ${result.error}\n\nDernière sortie de tests:\n\`\`\`\n${result.lastTestOutput.slice(-1500)}\n\`\`\``;

    this.post(webview, {
      type: 'agentFinal',
      text: summary,
      badges: [
        result.success
          ? { icon: '✅', label: 'Tests verts', variant: 'success' }
          : { icon: '❌', label: 'Échec', variant: 'error' }
      ]
    });
  }

  /** Workflows séquentiels prédéfinis (spec §5.2). */
  private async runWorkflow(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    workflowId: string,
    task: string,
    options: { isSmallModel?: boolean } = {}
  ): Promise<void> {
    this.post(webview, { type: 'chatStart' });
    const baseRegistry = await this.getToolRegistry();
    const registry = baseRegistry.clone();
    
    if (options.isSmallModel) {
      registry.restrictTo([
        'create_new_file', 
        'edit_existing_file', 
        'single_find_and_replace', 
        'read_file',
        'run_terminal_command'
      ]);
    }

    this.currentAbortController = new AbortController();
    const orchestrator = this.buildOrchestrator(active, registry);
    const runner = new WorkflowRunner(orchestrator, async () => {
      await this.getCheckpoints().createCheckpoint('workflow', `${workflowId}-${task.slice(0, 30)}`).catch(() => null);
    }, this.getConfiguredWorkflows());

    const started = Date.now();
    const result = await runner.run(workflowId, task, {
      ...this.agentEvents(webview),
      onStepStart: (step, index, total) =>
        this.post(webview, { type: 'workflowStep', step, index, total })
    });

    this.getAnalytics()?.trackAction({
      type: 'workflow',
      model: active.model,
      inputTokens: estimateTokens(task),
      outputTokens: estimateTokens(result.summary),
      duration: (Date.now() - started) / 1000,
      status: result.success ? 'success' : 'error'
    });

    if (result.success) {
      this.post(webview, {
        type: 'agentFinal',
        text: '', // Déjà streamé via onFinal Chunk
        badges: [{ icon: '✅', label: `${result.steps.length} étapes`, variant: 'success' }]
      });
    } else {
      const available = this.getConfiguredWorkflows().map(w => `\`${w.id}\``).join(', ');
      this.post(webview, {
        type: 'chatError',
        error: `${result.error}\nWorkflows disponibles: ${available}`
      });
    }
    this.postTokens(webview);
    this.post(webview, { type: 'chatDone' });
  }

  /** Handles `@read <path>`, `@list <path>`, `@write <path> <content>`, `@run <cmd>`. */
  private async handleToolCommand(webview: vscode.Webview, text: string): Promise<void> {
    const [command, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    this.post(webview, { type: 'chatStart' });

    try {
      let output = '';
      switch (command) {
        case 'read': {
          const content = await readFileTool(arg);
          const { cleaned, foundSecrets } = this.scrubber.scrub(content);
          output = `\`\`\`\n${cleaned}\n\`\`\``;
          if (foundSecrets.length > 0) {
            output += `\n\n⚠️ ${foundSecrets.length} secret(s) masqué(s) avant affichage.`;
          }
          operationLogger.log('read_file', arg, 'success');
          break;
        }
        case 'list': {
          const items = await listDirectoryTool(arg || '.');
          output = items
            .map(i => `${i.isDirectory ? '📁' : '📄'} ${i.path}`)
            .join('\n') || '(vide)';
          break;
        }
        case 'write': {
          const spaceIdx = arg.indexOf(' ');
          const filePath = spaceIdx === -1 ? arg : arg.slice(0, spaceIdx);
          const content = spaceIdx === -1 ? '' : arg.slice(spaceIdx + 1);
          const approval = await this.hitl.checkApproval('write_file', { path: filePath });
          if (!approval.granted) {
            output = `❌ ${approval.reason}`;
            operationLogger.log('write_file', `${filePath} — refusé`, 'blocked');
            break;
          }
          await writeFileTool(filePath, content);
          void this.indexer.reindexFile(filePath);
          output = `✅ Écrit: ${filePath}`;
          operationLogger.log('write_file', filePath, 'success');
          break;
        }
        case 'run': {
          const approval = await this.hitl.checkApproval('terminal', { command: arg });
          if (!approval.granted) {
            output = `❌ ${approval.reason}`;
            operationLogger.log('terminal', `${arg} — refusé`, 'blocked');
            break;
          }
          const timeout = this.getOpt(this.getOptimization().terminalTimeout, 'terminal.timeout', 30000);
          const result = await executeTerminalCommand(arg, {
            timeout,
            onData: chunk => this.post(webview, { type: 'terminalOutput', data: chunk })
          });
          output = `\`\`\`\n${result.stdout}${result.stderr}\n\`\`\`\n` +
            (result.timedOut ? '⏱️ Timeout' : `Code de sortie: ${result.exitCode}`);
          operationLogger.log('terminal', arg, result.success ? 'success' : 'error');
          this.getAnalytics()?.trackAction({
            type: 'terminal',
            model: 'n/a',
            inputTokens: 0,
            outputTokens: estimateTokens(output),
            duration: 0,
            status: result.success ? 'success' : 'error'
          });
          break;
        }
        default:
          output = `Commande inconnue: @${command}. Disponibles: @read, @list, @write, @run`;
      }

      this.post(webview, { type: 'chatChunk', text: output });
      this.post(webview, { type: 'chatDone' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post(webview, { type: 'chatError', error: msg });
    }
  }

  private async onListCheckpoints(webview: vscode.Webview): Promise<void> {
    try {
      const list = await this.getCheckpoints().listCheckpoints();
      this.post(webview, { type: 'checkpoints', checkpoints: list });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post(webview, { type: 'checkpoints', checkpoints: [], error: msg });
    }
  }

  private async onRollback(webview: vscode.Webview, ref: string): Promise<void> {
    const result = await this.getCheckpoints().rollback(ref);
    if (result.success) {
      vscode.window.showInformationMessage(`Jarvis: rollback completed (${ref})`);
      operationLogger.log('rollback', ref, 'success');
    } else {
      vscode.window.showErrorMessage(`Jarvis: rollback failed — ${result.error}`);
      operationLogger.log('rollback', `${ref}: ${result.error}`, 'error');
    }
    await this.onListCheckpoints(webview);
  }

  private onGetAnalytics(webview: vscode.Webview): void {
    const stats = this.getAnalytics()?.getStats();
    this.post(webview, { type: 'analytics', stats: stats ?? null });
  }

  public focus(): void {
    if (this._view) {
      this._view.show(true);
    } else {
      vscode.commands.executeCommand('jarvis.sidebarView.focus');
    }
  }

  public getIndexer(): WorkspaceIndexer {
    return this.indexer;
  }

  /** Rafraîchit le statut d'indexation affiché dans les Settings (section Workspaces). */
  public notifyIndexStatus(): void {
    if (this._view?.webview) this.postIndexStatus(this._view.webview);
  }

  public async inlineEdit(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage("Jarvis: no active editor for inline editing.");
      return;
    }
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showInformationMessage("Jarvis: please select code for inline editing (Cmd+K).");
      return;
    }

    const prompt = await vscode.window.showInputBox({
      title: 'Jarvis Inline Edit',
      placeHolder: 'Ex: Traduis ces commentaires en anglais...',
      prompt: 'Que dois-je modifier dans ce bloc de code ?'
    });

    if (!prompt) return;

    const active = this.getActiveProvider();
    if (!active) {
      vscode.window.showErrorMessage("Jarvis: Please configure a model to use Cmd+K.");
      return;
    }

    const doc = editor.document;
    const selectedText = doc.getText(selection);
    const filePath = vscode.workspace.asRelativePath(doc.uri, false);
    const startLine = selection.start.line + 1;
    const endLine = selection.end.line + 1;

    void vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Jarvis: édition en cours...' },
      async () => {
        try {
          const task = `Modifie le fichier \`${filePath}\` (Lignes ${startLine} à ${endLine}) pour répondre à la demande suivante :\n"${prompt}"\n\nCode cible :\n\`\`\`\n${selectedText}\n\`\`\``;
          
          if (this._view?.webview) {
            this.history.push({ role: 'user', content: task });
            this.getSessions()?.updateCurrent(this.history);
            // Affiche le prompt inline dans le chat (le task backend n'est jamais posté au webview autrement)
            this.post(this._view.webview, {
              type: 'inlinePrompt',
              prompt,
              file: filePath,
              startLine,
              endLine
            });
            await this.runAgent(this._view.webview, active, task, "MODE INLINE EDIT: Edite uniquement la section demandée dans le fichier via tes outils. Sois direct, pas d'explications superflues.");
          } else {
            vscode.window.showWarningMessage("Please open the Jarvis sidebar at least once to start.");
          }
        } catch (err) {
          vscode.window.showErrorMessage(`Cmd+K error: ${err instanceof Error ? err.message : err}`);
        }
      }
    );
  }

  private getModelConfigManager(): ModelConfigManager | null {
    if (this.modelConfigManager) {
      return this.modelConfigManager;
    }
    try {
      this.modelConfigManager = new ModelConfigManager();
      return this.modelConfigManager;
    } catch (error) {
      console.warn('ModelConfigManager indisponible:', error);
      return null;
    }
  }

  private getCheckpoints(): CheckpointManager {
    if (!this.checkpoints) {
      this.checkpoints = new CheckpointManager();
    }
    return this.checkpoints;
  }

  private getSessions(): SessionStore | null {
    if (!this.sessions) {
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!ws) return null;
      // On sauvegarde dans .vscode/jarvis-sessions.json du workspace principal
      const path = vscode.Uri.joinPath(vscode.Uri.file(ws), '.vscode', 'jarvis-sessions.json').fsPath;
      this.sessions = new SessionStore(path);
    }
    return this.sessions;
  }

  public getAnalytics(): AnalyticsCollector | null {
    if (!this.analytics) {
      try {
        this.analytics = new AnalyticsCollector();
      } catch {
        return null;
      }
    }
    return this.analytics;
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'app.css')
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'assets', 'app.js')
    );
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   img-src ${webview.cspSource} https: data:;
                   script-src ${webview.cspSource} 'nonce-${nonce}';
                   style-src ${webview.cspSource} 'unsafe-inline';
                   font-src ${webview.cspSource};">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Jarvis Agent</title>
    <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
    <div id="app"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  }
}

export class JarvisExtension {
  private statusBarItem: vscode.StatusBarItem | null = null;
  private sidebarProvider: JarvisSidebarProvider;
  private outputChannel: vscode.OutputChannel | null = null;

  constructor(private context: vscode.ExtensionContext) {
    this.sidebarProvider = new JarvisSidebarProvider(context);
  }

  public initialize(): void {
    console.log('JarvisExtension: initialisation');
    this.setupStatusBar();
    this.setupLogging();

    const registration = vscode.window.registerWebviewViewProvider(
      JarvisSidebarProvider.viewType,
      this.sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
    this.context.subscriptions.push(registration);

    // Enregistrement de la revue de diffs intégrée (CodeLenses + décorations + commandes)
    const codeLensProvider = new JarvisCodeLensProvider(() => this.sidebarProvider.getChangeTracker());
    const decorationProvider = new DiffDecorationProvider(() => this.sidebarProvider.getChangeTracker());
    this.context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
      decorationProvider,
      // Réapplique les couleurs vert/rouge quand l'éditeur affiché change.
      vscode.window.onDidChangeActiveTextEditor(() => decorationProvider.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => decorationProvider.refresh())
    );

    this.sidebarProvider.onChangesChanged = () => {
      codeLensProvider.refresh();
      decorationProvider.refresh();
    };

    this.context.subscriptions.push(
      vscode.commands.registerCommand('jarvis.acceptHunk', async (filePath: string, hunkId: number, revision: number) => {
        await this.sidebarProvider.resolveHunk(filePath, hunkId, revision, 'accept');
      }),
      vscode.commands.registerCommand('jarvis.rejectHunk', async (filePath: string, hunkId: number, revision: number) => {
        await this.sidebarProvider.resolveHunk(filePath, hunkId, revision, 'reject');
      }),
      vscode.commands.registerCommand('jarvis.acceptFile', async (filePath: string) => {
        await this.sidebarProvider.resolveFile(filePath, 'accept');
      }),
      vscode.commands.registerCommand('jarvis.rejectFile', async (filePath: string) => {
        await this.sidebarProvider.resolveFile(filePath, 'reject');
      }),
      vscode.commands.registerCommand('jarvis.acceptAll', async () => {
        await this.sidebarProvider.resolveAllChanges('accept');
      }),
      vscode.commands.registerCommand('jarvis.rejectAll', async () => {
        await this.sidebarProvider.resolveAllChanges('reject');
      })
    );

    // Jauge de tokens dans la status bar (spec §2.1)
    this.sidebarProvider.onTokensChanged = usage => {
      if (!this.statusBarItem) return;
      const icon = usage.level === 'green' ? '$(hubot)' : usage.level === 'orange' ? '$(warning)' : '$(error)';
      this.statusBarItem.text = `${icon} Jarvis ${usage.percentage}%`;
      this.statusBarItem.tooltip =
        `Jarvis Agent — ${usage.used.toLocaleString()} / ${usage.limit?.toLocaleString() ?? '—'} tokens ` +
        `(⬆️ ${usage.inputTokens.toLocaleString()} / ⬇️ ${usage.outputTokens.toLocaleString()})`;
    };

    // Checkpoint de session (spec §6.2)
    if (vscode.workspace.workspaceFolders?.length) {
      void new CheckpointManager().createCheckpoint('session', 'session-start').catch(() => null);
    }
  }

  private setupLogging(): void {
    this.outputChannel = vscode.window.createOutputChannel('Jarvis Agent');
    this.context.subscriptions.push(this.outputChannel);
    const unsubscribe = operationLogger.onEntry(entry => {
      const flag = { info: 'ℹ️', success: '✅', error: '❌', blocked: '⛔' }[entry.status];
      this.outputChannel?.appendLine(`[${entry.timestamp}] ${flag} ${entry.operation}: ${entry.details}`);
    });
    this.context.subscriptions.push({ dispose: unsubscribe });
  }

  private setupStatusBar(): void {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.text = '$(hubot) Jarvis';
    this.statusBarItem.tooltip = 'Jarvis Agent — cliquer pour ouvrir';
    this.statusBarItem.command = 'jarvis.startChat';
    this.statusBarItem.show();
    this.context.subscriptions.push(this.statusBarItem);
  }

  public startChat(): void {
    this.sidebarProvider.focus();
  }

  public showRollbackPanel(): void {
    this.sidebarProvider.focus();
    vscode.window.showInformationMessage('Jarvis: open the Checkpoints tab in the sidebar.');
  }

  public async listCheckpoints(): Promise<void> {
    try {
      const manager = new CheckpointManager();
      const list = await manager.listCheckpoints();
      if (list.length === 0) {
        vscode.window.showInformationMessage('Jarvis: no checkpoint available.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        list.map(c => ({ label: c.description, description: c.ref, detail: c.id })),
        { title: 'Jarvis Checkpoints — sélectionnez pour rollback' }
      );
      if (pick) {
        const result = await manager.rollback(pick.description ?? '');
        if (result.success) {
          vscode.window.showInformationMessage(`Rollback completed: ${pick.label}`);
        } else {
          vscode.window.showErrorMessage(`Rollback failed: ${result.error}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Jarvis checkpoints: ${msg}`);
    }
  }

  public async exportAnalytics(): Promise<void> {
    try {
      const analytics = this.sidebarProvider.getAnalytics();
      if (!analytics) {
        vscode.window.showWarningMessage('Jarvis: analytics unavailable (workspace required).');
        return;
      }
      await analytics.export();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Jarvis export: ${msg}`);
    }
  }

  /** Commande "Jarvis: Generate .jarvisignore". */
  public async generateJarvisignore(): Promise<void> {
    try {
      const sandbox = new SandboxManager();
      await sandbox.regenerateIgnoreFile();
      setSandbox(sandbox);
      vscode.window.showInformationMessage('Jarvis: .jarvisignore regenerated with recommended patterns.');
      operationLogger.log('jarvisignore', 'régénéré', 'success');
    } catch (err) {
      vscode.window.showErrorMessage(`Jarvis: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Commande "Jarvis: Add to .jarvisignore" (fichier sélectionné ou saisie). */
  public async addToJarvisignore(uri?: vscode.Uri): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) throw new Error('Workspace introuvable');

      let pattern: string | undefined;
      if (uri) {
        pattern = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      } else {
        pattern = await vscode.window.showInputBox({
          title: 'Pattern à ajouter à .jarvisignore',
          placeHolder: 'ex: secrets/ ou *.pem'
        });
      }
      if (!pattern) return;

      const sandbox = new SandboxManager();
      await sandbox.addIgnorePattern(pattern);
      setSandbox(sandbox);
      vscode.window.showInformationMessage(`Jarvis: "${pattern}" added to .jarvisignore.`);
      operationLogger.log('jarvisignore', `+ ${pattern}`, 'success');
    } catch (err) {
      vscode.window.showErrorMessage(`Jarvis: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Commande "Jarvis: Remove from .jarvisignore". */
  public async removeFromJarvisignore(): Promise<void> {
    try {
      const sandbox = new SandboxManager();
      const patterns = sandbox.getIgnorePatterns();
      if (patterns.length === 0) {
        vscode.window.showInformationMessage('Jarvis: .jarvisignore is empty.');
        return;
      }
      const pick = await vscode.window.showQuickPick(patterns, {
        title: 'Pattern à retirer de .jarvisignore'
      });
      if (!pick) return;
      await sandbox.removeIgnorePattern(pick);
      setSandbox(sandbox);
      vscode.window.showInformationMessage(`Jarvis: "${pick}" removed from .jarvisignore.`);
      operationLogger.log('jarvisignore', `- ${pick}`, 'success');
    } catch (err) {
      vscode.window.showErrorMessage(`Jarvis: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Commande "Jarvis: Index Workspace" (RAG). */
  public async indexWorkspace(): Promise<void> {
    const indexer = this.sidebarProvider.getIndexer();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Jarvis: indexation du workspace…' },
      async progress => {
        const count = await indexer.indexWorkspace((done, total) => {
          progress.report({ message: `${done}/${total} fichiers` });
        });
        vscode.window.showInformationMessage(`Jarvis: ${count} files indexed for RAG search.`);
        // Rafraîchit l'état affiché dans Settings > Workspaces si la sidebar est ouverte
        // (jusqu'ici seul le chemin webview → indexWorkspace notifiait le webview).
        this.sidebarProvider.notifyIndexStatus();
      }
    );
  }

  public async inlineEdit(): Promise<void> {
    await this.sidebarProvider.inlineEdit();
  }
}
