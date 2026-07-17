import * as vscode from 'vscode';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { ModelConfigManager, createProviderFromItem } from '../config/model-config-manager.js';
import { getConfigManager, normalizeConfig, type JarvisConfig, type DocSite, type ToolPolicy, type ModelItem } from '../config/config-manager.js';
import { ChatMessage, IModelProvider } from '../models/abstract.js';
import { SessionStore, buildResumeContext } from '../services/sessions.js';
import { HITLManager, HITLMode, ApprovalPromptDecision } from '../services/hitl.js';
import { CheckpointManager, type Checkpoint } from '../services/checkpoint.js';
import { AnalyticsCollector } from '../services/analytics.js';
import { TokenCounter, TokenUsage, TokenSnapshot, estimateTokens } from '../services/token-counter.js';
import { ResponseCache } from '../services/response-cache.js';
import { AutoTDDLoop } from '../services/tdd-loop.js';
import { detectAgentMention, suggestAgent, getAgents } from '../services/agents.js';
import { WorkflowRunner, getWorkflows } from '../services/workflows.js';
import { loadRules, renderRules } from '../services/rules.js';
import { loadJarvisMd, renderJarvisMd } from '../services/jarvis-md.js';
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
import type { TodoItem } from './agent/todo.js';
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
  getSandbox,
  setSandbox,
  resolveWorkspacePath
} from './mcp/tools/fileSystem.js';
import { executeTerminalCommand } from './mcp/tools/terminal.js';
import { McpManager } from './mcp/manager.js';
import { getBuiltinMcpServers, builtinCommandString, isGitRepository } from './mcp/builtin.js';

const BASE_SYSTEM_PROMPT =
  'You are Jarvis, an agentic coding assistant embedded in VS Code. ' +
  'Reply concisely and technically. Use Markdown to format your code.\n' +
  'CRITICAL RULE: Never get stuck in a loop. If you notice yourself repeating the same action, the same command, or writing the same file multiple times, STOP IMMEDIATELY, consider the task done (or blocked), and give your final answer.';

/** Persona for the /init command: generates JARVIS.md from a project analysis. */
const INIT_SYSTEM_PROMPT =
  'You are Jarvis in /init mode. Your only task is to analyze this project (package.json or equivalent, ' +
  'folder structure via ls/file_glob_search, entry points, visible code conventions) and then ' +
  'create the JARVIS.md file at the workspace root using your file tools. ' +
  'Do not modify any other file. Stay concise, factual, and actionable — no generic filler.';

/** workspaceState key: token gauge snapshot (session persistence). */
const TOKEN_STATE_KEY = 'jarvis.tokenState';
/** globalState key: onboarding has been completed at least once. */
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
  /** Pending approvals (card in the chat), keyed by HITL prompt id. */
  private pendingApprovals = new Map<string, (d: ApprovalPromptDecision | null) => void>();
  private currentAbortController: AbortController | null = null;

  /** messageId -> checkpoint captured just before that message's turn ran.
   *  Rewind via `checkpoint.id` (CheckpointManager.restoreToCheckpoint), never `.ref` —
   *  refs are positional (`stash@{N}`) and go stale as soon as a newer checkpoint exists. */
  private messageCheckpoints = new Map<string, Checkpoint>();
  /** messageId -> index into `this.history` where that user turn landed. Cleared/pruned
   *  whenever `this.history` is wholesale-reassigned or forked. */
  private historyIndexByMessageId = new Map<string, number>();

  /** Notifies the host (status bar) whenever token usage changes. */
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

  /** Optimization settings from the Jarvis config (source of truth, spec §7). */
  private getOptimization(): NonNullable<JarvisConfig['optimization']> {
    try {
      return getConfigManager().getConfig().optimization ?? {};
    } catch {
      return {};
    }
  }

  /** Jarvis config value if defined, otherwise falls back to the VS Code setting. */
  private getOpt<T>(configValue: T | undefined, vsCodeKey: string, fallback: T): T {
    if (configValue !== undefined) return configValue;
    const value = vscode.workspace.getConfiguration('jarvis').get<T>(vsCodeKey);
    return value ?? fallback;
  }

  /** Rendered content of JARVIS.md, refreshed in the background by the watcher (see `ensureJarvisMdWatcher`). */
  private jarvisMdText = '';
  private jarvisMdWatcherRegistered = false;

  /** Registers (once) the watcher that invalidates/reloads JARVIS.md, and triggers the first read. */
  private ensureJarvisMdWatcher(): void {
    if (this.jarvisMdWatcherRegistered) return;
    this.jarvisMdWatcherRegistered = true;
    void this.refreshJarvisMd();
    if (!vscode.workspace.workspaceFolders?.length) return;
    const watcher = vscode.workspace.createFileSystemWatcher('**/JARVIS.md');
    const refresh = () => { void this.refreshJarvisMd(); };
    watcher.onDidChange(refresh);
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    this.context.subscriptions.push(watcher);
  }

  private async refreshJarvisMd(): Promise<void> {
    try {
      const content = await loadJarvisMd(p => readFileTool(p));
      this.jarvisMdText = renderJarvisMd(content);
    } catch {
      this.jarvisMdText = '';
    }
  }

  /** JARVIS.md project instructions (workspace root), empty if absent. */
  private getJarvisMdText(): string {
    this.ensureJarvisMdWatcher();
    return this.jarvisMdText;
  }

  /** Relative path of the active file in the editor, for folder-scoped rules (§6). */
  private getActiveFilePath(): string | null {
    const uri = vscode.window.activeTextEditor?.document.uri;
    return uri ? vscode.workspace.asRelativePath(uri, false) : null;
  }

  /** User rules block (Settings tab), empty if none. */
  private getRulesText(): string {
    try {
      return renderRules(loadRules(getConfigManager().getConfig(), this.getActiveFilePath()));
    } catch {
      return '';
    }
  }

  /** Active workspace instructions (CLAUDE.md-style), empty if none. */
  private getWorkspaceInstructionsText(): string {
    try {
      return renderWorkspaceInstructions(getActiveWorkspace(getConfigManager().getConfig()));
    } catch {
      return '';
    }
  }

  /** Verbosity instruction injected into prompts (empty in `normal` mode). */
  private getVerbosityInstruction(): string {
    switch (this.getOptimization().verbosity) {
      case 'concise':
        return 'RESPONSE STYLE: be brief and direct. Get straight to the point, with no preamble or unnecessary recap. Favor short sentences and lists.';
      case 'detailed':
        return 'RESPONSE STYLE: be detailed and instructive. Explain your reasoning, and provide useful context and examples.';
      default:
        return '';
    }
  }

  /** JARVIS.md + rules + active workspace instructions + verbosity, for system prompts. */
  private getPromptExtras(): string {
    return [
      this.getJarvisMdText(),
      this.getRulesText(),
      this.getWorkspaceInstructionsText(),
      this.getVerbosityInstruction()
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** System prompt for direct chat, including rules + workspace (spec §5.2). */
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
      console.warn('McpManager unavailable:', err);
      return null;
    }
  }

  private getDocsService(): DocsService {
    if (!this.docsService) this.docsService = new DocsService();
    return this.docsService;
  }

  /** Merged @docs: search: workspace .md files + cached documentation. */
  private async searchAllDocs(query: string): Promise<RagSearchResult[]> {
    const internal = await this.indexer.searchDocs(query);
    const external = await this.getDocsService().search(query);
    return mergeSearchResults(5, internal, external);
  }

  /**
   * RAG context augmentation (spec §5.2): searches the workspace's semantic index
   * for code snippets potentially relevant to the task, and adds them to the prompt
   * sent to the model. Only affects the prompt for THIS call — the text
   * inserted into `this.history` by the caller remains unaugmented (no pollution of
   * the persisted/displayed history).
   */
  private async augmentTaskWithCodeContext(task: string): Promise<string> {
    if (this.indexer.index.size === 0 || task.trim().length < 20) return task;
    try {
      const results = await this.indexer.search(task, 3);
      const augmented = augmentWithCodeContext(task, results);
      if (augmented !== task) {
        operationLogger.log('rag', 'Context augmented with relevant project snippets.');
      }
      return augmented;
    } catch (err) {
      operationLogger.log('rag', `Context augmentation failed: ${err instanceof Error ? err.message : err}`, 'error');
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
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(
      message => this.handleMessage(webviewView.webview, message),
      undefined,
      this.context.subscriptions
    );

    // Webview closed: unblocks pending approvals (native fallback) and
    // detaches the handler to avoid posting to a dead webview.
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
          const messageId = typeof message.id === 'string' ? message.id : undefined;
          await this.onChatMessage(webview, message.text, mode, messageId);
        }
        break;
      case 'planProceed':
        await this.onPlanProceed(webview, typeof message.id === 'string' ? message.id : undefined);
        break;
      case 'listCheckpoints':
        await this.onListCheckpoints(webview);
        break;
      case 'rollback':
        if (typeof message.id === 'string') {
          await this.onRollback(webview, message.id);
        }
        break;
      case 'rewindToMessage':
        if (typeof message.messageId === 'string') {
          await this.onRewindToMessage(webview, message.messageId);
        }
        break;
      case 'forkConversation':
        if (typeof message.messageId === 'string') {
          this.onForkConversation(webview, message.messageId);
        }
        break;
      case 'forkAndRewind':
        if (typeof message.messageId === 'string') {
          await this.onForkAndRewind(webview, message.messageId);
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
          operationLogger.log('hitl', `HITL mode: ${message.mode}`);
          // Persists the mode so it survives a window reload.
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
      case 'requestGitInit':
        await this.onRequestGitInit(webview);
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
          this.post(webview, { type: 'chatError', error: 'Generation canceled by the user.' });
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
        operationLogger.log('config', 'Onboarding completed');
        break;
    }
  }

  /**
   * Provider connection test during onboarding: sends a minimal prompt
   * via an ephemeral provider (no config persistence).
   */
  private async onTestConnection(webview: vscode.Webview, item: ModelItem): Promise<void> {
    try {
      if (!item.provider || !item.model) {
        throw new Error('Provider and model required');
      }
      const provider = createProviderFromItem(item);
      const res = await provider.sendPrompt(
        [{ role: 'user', content: 'ping' }],
        undefined,
        AbortSignal.timeout(20000)
      );
      const text = typeof res === 'string' ? res : res.text;
      this.post(webview, { type: 'connectionResult', ok: true, sample: (text ?? '').slice(0, 120) });
      operationLogger.log('config', `Connection test OK (${item.provider}/${item.model})`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.post(webview, { type: 'connectionResult', ok: false, error: msg });
      operationLogger.log('config', `Connection test failed (${item.provider}): ${msg}`, 'error');
    }
  }

  /** Resolves the pending approval promise with the chat's decision. */
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
      const msg = `I rejected the following change in the file \`${pathStr}\`:\n${rejectedDiff}\n\nPlease propose an alternative directly in the chat (do not use your file-editing tools).`;
      const messageId = randomUUID();
      this.post(this._view.webview, { type: 'injectUserMessage', text: msg, id: messageId });
      await this.onChatMessage(this._view.webview, msg, 'Automatic', messageId);
    }
  }

  public async resolveFile(pathStr: string, action: 'accept' | 'reject'): Promise<void> {
    const diskAction = this.changeTracker.resolveFile(pathStr, action);
    if (diskAction) {
      await this.applyDiskAction(diskAction);
    }

    if (action === 'reject' && this._view?.webview) {
      const msg = `I rejected ALL changes in the file \`${pathStr}\`. Please propose an alternative directly in the chat (do not use your file-editing tools).`;
      const messageId = randomUUID();
      this.post(this._view.webview, { type: 'injectUserMessage', text: msg, id: messageId });
      await this.onChatMessage(this._view.webview, msg, 'Automatic', messageId);
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
      operationLogger.log('extension', `onOpenFile failed: ${err instanceof Error ? err.message : err}`, 'error');
      vscode.window.showErrorMessage(`Jarvis: unable to open file — ${err instanceof Error ? err.message : err}`);
    }
  }

  private async onResolveAll(webview: vscode.Webview, message: Record<string, unknown>): Promise<void> {
    const { action } = message as { action: 'accept' | 'reject' };
    await this.resolveAllChanges(action);
  }

  /** Accepts/rejects all pending changes (commands + webview). */
  public async resolveAllChanges(action: 'accept' | 'reject'): Promise<void> {
    const diskActions = this.changeTracker.resolveAll(action);
    for (const d of diskActions) {
      await this.applyDiskAction(d);
    }

    if (action === 'reject' && diskActions.length > 0 && this._view?.webview) {
      const paths = diskActions.map(d => `\`${d.path}\``).join(', ');
      const msg = `I rejected ALL pending changes in the following files: ${paths}. Please propose an alternative directly in the chat (do not use your file-editing tools).`;
      const messageId = randomUUID();
      this.post(this._view.webview, { type: 'injectUserMessage', text: msg, id: messageId });
      await this.onChatMessage(this._view.webview, msg, 'Automatic', messageId);
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
        operationLogger.log('diff-review', `Error applying the action on ${action.path}: ${String(err)}`, 'error');
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
   * Suggestions for the `@docs:` mention (spec Phase 4): proposes configured and enabled
   * documentation sites (Settings > Docs) — @docs: queries crawled sites, not workspace
   * files (see DocsSection.svelte text).
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
      operationLogger.log('workspace', `Active workspace: ${id ?? 'none'}`);
    } catch (err) {
      operationLogger.log('workspace', `setActiveWorkspace failed: ${err instanceof Error ? err.message : err}`, 'error');
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
    // Kick off JARVIS.md reading early so it's ready before the first message.
    this.ensureJarvisMdWatcher();

    // Delegates HITL confirmations to the approval card in the chat.
    // `null` return impossible here (webview ready) → no native dialog.
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
    // Session persistence: restores the gauge from the last session (reload/restart).
    this.tokenCounter.restore(this.context.workspaceState.get<TokenSnapshot>(TOKEN_STATE_KEY));

    // Avatar video (media/), best-effort: UI falls back to the static icon if absent.
    try {
      const avatarUri = webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', 'Jarvis Avatar Animation.mp4')
      );
      this.post(webview, { type: 'avatarUri', uri: avatarUri.toString() });
    } catch {
      /* best-effort */
    }

    this.post(webview, {
      type: 'status',
      text: needsSetup ? 'No model configured — open Settings' : `Connected — model: ${model}`,
      success: !needsSetup,
      needsSetup,
      models: models.map(m => m.name),
      model: model ?? ''
    });
    // Onboarding: the App shows the welcome screen if never completed OR if no model is set.
    this.post(webview, {
      type: 'onboardingState',
      done: this.context.globalState.get<boolean>(ONBOARDING_DONE_KEY, false)
    });
    this.postTokens(webview);
    this.rehydrateChatHistory(webview);
    this.postCapabilities(webview);
    // The App needs the config at startup (showThinking, docs, workspaces...).
    void this.onGetSettings(webview);

    // Re-hydrate the documentation index from the disk cache.
    try {
      const docs = getConfigManager().getConfig().docs ?? [];
      void this.getDocsService().loadFromCache(docs.filter(d => d.enabled)).catch(() => undefined);
    } catch {
      /* best-effort */
    }

    // Background RAG indexing (spec §5.2)
    void this.indexWorkspaceInBackground(webview);
  }

  /** Dynamic lists (agents, workflows, workspaces) for the chat. */
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

  /** Launches crawling + indexation of a docs site, with progress to the UI. */
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
      operationLogger.log('docs', `Site ${site.title || site.startUrl} indexed (${pages} pages)`, 'success');
      this.post(webview, {
        type: 'docsStatus',
        sites: [{ id, state: 'done', pages, indexedAt: new Date().toISOString() }]
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('docs', `Docs indexing failed (${id}): ${msg}`, 'error');
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

  /**
   * The builtin `git` stays disabled by default if the open folder is not
   * itself a git repository root (`mcp-server-git` would fail with
   * "not a valid Git repository"). This flow lets the user enable it
   * explicitly from Settings: modal confirmation ("git init" is a
   * visible/irreversible action, so never silent), then `git init`,
   * persistent activation, reconnect.
   */
  /**
   * Confirms then runs `git init` in `workspaceFolder` if it isn't already a repository.
   * Visible/irreversible action: never silent (modal dialog). Returns true if the
   * folder is (already or now) a git repository, false if the user declined or on failure.
   */
  private async ensureGitInitialized(workspaceFolder: string): Promise<boolean> {
    if (isGitRepository(workspaceFolder)) return true;

    const choice = await vscode.window.showWarningMessage(
      `This folder isn't a Git repository. This will run "git init" in ${workspaceFolder}. Continue?`,
      { modal: true },
      'OK'
    );
    if (choice !== 'OK') return false;

    const result = await executeTerminalCommand('git init', { cwd: workspaceFolder });
    if (!result.success) {
      vscode.window.showErrorMessage(`Jarvis: git init failed — ${result.stderr || result.stdout}`);
      operationLogger.log('mcp', `git init failed (${workspaceFolder}): ${result.stderr}`, 'error');
      return false;
    }
    operationLogger.log('mcp', `git init executed in ${workspaceFolder}`, 'success');
    return true;
  }

  private async onRequestGitInit(webview: vscode.Webview): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return;

    if (!(await this.ensureGitInitialized(workspaceFolder))) return;

    await this.enableGitMcpBuiltin(webview);
  }

  /**
   * Persists the activation of the `git` MCP builtin (explicit override, idempotent) and
   * reconnects the manager. To be called after a successful `git init` (Settings or `/init`)
   * so that git MCP tools are available without additional manual action.
   */
  private async enableGitMcpBuiltin(webview: vscode.Webview): Promise<void> {
    try {
      const config = getConfigManager().getGlobalConfig();
      if (config.builtinMcp?.git?.enabled !== true) {
        await getConfigManager().writeGlobal({
          ...config,
          builtinMcp: { ...config.builtinMcp, git: { ...config.builtinMcp?.git, enabled: true } }
        });
      }
    } catch (err) {
      operationLogger.log('mcp', `git builtin activation failed: ${err instanceof Error ? err.message : err}`, 'error');
    }

    await this.mcpManager?.reload().catch(() => undefined);
    await this.onGetSettings(webview);
    await this.onGetMcpStatus(webview);
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

  /** Persists the gauge snapshot (survives reload + restart). */
  private persistTokenState(): void {
    void this.context.workspaceState.update(TOKEN_STATE_KEY, this.tokenCounter.serialize());
  }

  /**
   * Repopulates the webview chat with the current session after a reload
   * (history lives on disk via SessionStore but the webview starts empty).
   * No-op if the backend already has history in memory (webview was just hidden).
   */
  private rehydrateChatHistory(webview: vscode.Webview): void {
    if (this.history.length > 0) return;
    const current = this.getSessions()?.getCurrent();
    const stored = current?.messages ?? [];
    if (stored.length === 0) return;
    // Restores backend context so the conversation continues coherently.
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

  // (Removed as it is implemented further below with the full MCP logic)

  /** Opens the global config (~/.jarvis/config.json) in the editor. */
  private async onOpenConfigFile(): Promise<void> {
    try {
      // loadSync created the file on first launch; open it directly.
      const uri = vscode.Uri.file(getConfigManager().getGlobalConfigPath());
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('config', `openConfigFile failed: ${msg}`, 'error');
      vscode.window.showErrorMessage(`Jarvis: unable to open config — ${msg}`);
    }
  }

  /** Opens README.md as a preview (User Guide). */
  private async onOpenUserGuide(): Promise<void> {
    try {
      const uri = vscode.Uri.file(path.join(this.context.extensionPath, 'README.md'));
      await vscode.commands.executeCommand('markdown.showPreview', uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      operationLogger.log('extension', `openUserGuide failed: ${msg}`, 'error');
      vscode.window.showErrorMessage(`Jarvis: unable to open guide — ${msg}`);
    }
  }

  /** Sends the raw global config to the webview for editing in the Settings tab. */
  private async onGetSettings(webview: vscode.Webview): Promise<void> {
    let config: JarvisConfig;
    let needsSetup = true;
    try {
      config = getConfigManager().getGlobalConfig();
      needsSetup = config.models.items.length === 0;
    } catch (err) {
      operationLogger.log('config', `getSettings failed: ${err instanceof Error ? err.message : err}`, 'error');
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

  /** Persists the edited config (global scope) then re-instantiates providers + status. */
  private async onUpdateSettings(webview: vscode.Webview, incoming: JarvisConfig): Promise<void> {
    try {
      const previousDocs = getConfigManager().getGlobalConfig().docs ?? [];
      const config = normalizeConfig(incoming);
      await getConfigManager().writeGlobal(config);
      void this.syncDocsWithConfig(previousDocs, config.docs ?? []).catch(() => undefined);
      const configManager = this.getModelConfigManager();
      configManager?.refresh();
      this.toolRegistry = null; // will be rebuilt with up-to-date MCP tools
      await this.mcpManager?.reload().catch(() => undefined);
      this.postCapabilities(webview);
      // Applies the HITL mode live (otherwise only effective after reload).
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
      operationLogger.log('config', `updateSettings failed: ${msg}`, 'error');
      this.post(webview, { type: 'settingsSaved', ok: false, error: msg });
    }
  }

  /** Applies the docs-site diff after save: purges removed/disabled, loads enabled ones. */
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
      operationLogger.log('rag', `Indexing complete: ${count} files`, 'success');
    } catch (err) {
      operationLogger.log('rag', `Indexing failed: ${err instanceof Error ? err.message : err}`, 'error');
    } finally {
      if (webview) this.postIndexStatus(webview);
    }
  }

  private getActiveProvider(): { provider: IModelProvider; providerName: string; model: string } | null {
    const configManager = this.getModelConfigManager();
    if (!configManager) return null;
    const model = configManager.getEffectiveModel();
    if (!model) return null;
    // One provider is instantiated per model (model-centric schema).
    const provider = configManager.getProvider(model);
    if (!provider) return null;
    const providerName = configManager.getProviderNameForModel(model) ?? 'openai-compatible';
    return { provider, providerName, model };
  }

  /** Secret scrubbing — always active for cloud providers (spec §6.1). */
  private maybeScrub(text: string, providerName: string): string {
    const configManager = this.getModelConfigManager();
    if (!configManager?.isCloudProvider(providerName)) return text;
    const { cleaned, foundSecrets } = this.scrubber.scrub(text);
    if (foundSecrets.length > 0) {
      operationLogger.log('scrubbing', `${foundSecrets.length} secret(s) masked before cloud send`, 'blocked');
    }
    return cleaned;
  }

  /**
   * Single choke point for recording a user turn: pushes it onto `this.history`
   * and, if the frontend sent a `messageId` for it, records the resulting index
   * and tells the webview this message is now fork-capable. Every push site
   * MUST go through this (rather than pushing to `this.history` directly) —
   * that's what lets the frontend's rewind/fork menu correctly stay hidden on
   * turns that don't call this (e.g. /tdd, /workflow, /agent, /init, which
   * intentionally aren't part of the tracked conversation history).
   */
  private recordUserTurn(webview: vscode.Webview, entry: ChatMessage, messageId?: string): void {
    this.history.push(entry);
    if (messageId) {
      this.historyIndexByMessageId.set(messageId, this.history.length - 1);
      this.post(webview, { type: 'forkable', messageId });
    }
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
        defaultEnabled: b.config.enabled,
        requiresGitInit: !!b.requiresOwnGitRepo && !!workspaceFolder && !isGitRepository(workspaceFolder)
      })),
      customTools,
      agents: getAgents(),
      workflows: getWorkflows()
    };
  }

  private async runPlanMode(webview: vscode.Webview, active: { provider: IModelProvider; providerName: string; model: string }, expanded: string): Promise<void> {
    operationLogger.log('chat', 'Plan Mode: Generating implementation_plan.md');
    const planSystemPrompt =
      "SPECIAL RULE PLAN MODE: You are in Plan mode. Explore the project with your read-only tools to document yourself, " +
      "optionally set the step checklist with update_todo_list, then write the detailed implementation plan " +
      "directly in your final Markdown response. Do NOT create or modify ANY physical files on disk and " +
      "do NOT run any command — these tools are not available in this mode. Your sole goal is to respond with " +
      "the complete plan formatted in Markdown.";

    let finalPrompt = expanded;
    const lastAssistantMsg = [...this.history].reverse().find(m => m.role === 'assistant');
    if (lastAssistantMsg) {
      finalPrompt = `Here is the current implementation plan:\n\n${lastAssistantMsg.content}\n\nModification instructions:\n${expanded}\n\nRedo the plan completely applying these instructions.`;
    }

    const planText = await this.runAgent(webview, active, finalPrompt, planSystemPrompt, undefined, {
      kind: 'plan',
      planOnly: true,
      allowedToolPrefixes: [
        'read_file', 'read_currently_open_file', 'grep_search', 'ls', 'file_glob_search',
        'git_status', 'git_log', 'view_diff', 'search_web', 'update_todo_list'
      ]
    });
    if (planText) this.history.push({ role: 'assistant', content: planText });
    this.getSessions()?.updateCurrent(this.history);
  }

  /**
   * Executes the validated plan. Goes directly through the agent (with its tools) instead of
   * `onChatMessage(..., 'Automatic')`: the automatic router only sees this isolated message
   * and frequently reclassifies it as [PLAN] intention, which would restart `runPlanMode` (and thus
   * regenerate the plan) instead of implementing.
   */
  private async onPlanProceed(webview: vscode.Webview, messageId?: string): Promise<void> {
    const text =
      "The plan is validated. Proceed with its implementation step by step, following the steps in the plan " +
      "above. Use update_todo_list to track your progress live on these steps.";
    operationLogger.log('chat', `Message received [mode: Proceed]: ${text}`);

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

    const recentHistory = this.history.slice(-10);
    const finalText = await this.runAgent(webview, active, text, undefined, recentHistory, { messageId });
    this.recordUserTurn(webview, { role: 'user', content: this.maybeScrub(text, active.providerName) }, messageId);
    if (finalText) this.history.push({ role: 'assistant', content: finalText });
    this.getSessions()?.updateCurrent(this.history);
  }

  private async onChatMessage(webview: vscode.Webview, rawText: string, mode: string = 'Automatic', messageId?: string): Promise<void> {
    operationLogger.log('chat', `Message received [mode: ${mode}]: ${rawText.slice(0, 80)}`);

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
      this.post(webview, { type: 'chatChunk', text: "\n\n*(Small model detected: Automatic switch to Fast mode)*\n\n" });
      operationLogger.log('chat', `Small model detected (${active.model}), routing forced to Fast mode`);
    }

    // Deterministic tool commands (@read, @list, @write, @run)
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

    if (/^\/rollback\s*$/.test(rawText)) {
      await this.onRollbackLastMessage(webview);
      return;
    }

    // Saved prompts: `/name args` → prompt content + args
    // (reserved commands /tdd, /workflow, /agent, /init are never shadowed).
    if (rawText.startsWith('/')) {
      const expandedPrompt = expandPrompt(rawText, this.getConfiguredPrompts());
      if (expandedPrompt !== null) rawText = expandedPrompt;
    }

    // Expansion des mentions @file: / @docs: (spec Phase 4)
    const { expanded } = await expandMentions(rawText, {
      readFile: p => readFileTool(p),
      searchDocs: q => this.searchAllDocs(q)
    });



    // Project init: git init if needed + JARVIS.md generation
    if (rawText.startsWith('/init')) {
      await this.runInit(webview, active);
      return;
    }

    // Boucle Auto-TDD (spec §3.3)
    if (rawText.startsWith('/tdd ')) {
      await this.runTDD(webview, active, expanded.replace(/^\/tdd\s+/, ''));
      return;
    }

    // Predefined workflows (spec §5.2)
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

    // Specialized agents via @QA-Agent mention etc. (spec §5.1)
    const mention = detectAgentMention(rawText, this.getConfiguredAgents());
    if (mention) {
      const { expanded: task } = await expandMentions(mention.task, {
        readFile: p => readFileTool(p),
        searchDocs: q => this.searchAllDocs(q)
      });
      await this.runAgent(webview, active, task, mention.agent.systemPrompt, undefined, {
        allowedToolPrefixes: mention.agent.allowedToolPrefixes
      });
      return;
    }

    // Plan Mode: strict workflow (Analyse, Plan, Validation, Implementation)
    if (mode === 'Plan') {
      await this.runPlanMode(webview, active, expanded);
      return;
    }

    // Fast Mode: direct chat without tools, immediate text response
    if (mode === 'Fast') {
      operationLogger.log('chat', 'Fast mode: switching to streamChat without tools');
      await this.streamChat(webview, active, expanded, rawText, messageId);
      return;
    }

    // === AUTOMATIC ROUTER ===
    // Upstream check whether the question requires tools (only in Automatic mode)
    if (mode === 'Automatic') {
      try {
        const routerPrompt = [
          { role: 'system' as const, content: 'You are an intention classifier. Think out loud in a short sentence, then you MUST end your response with the exact word "[TOOLS]", "[CHAT]" or "[PLAN]".\n"[CHAT]" for simple greetings or theoretical questions that require no action (e.g., "who are you?", "how does React work?").\n"[TOOLS]" if the user requests a moderate, technical, one-off action or editing of 1-3 files (e.g., "create a button component", "fix this bug").\n"[PLAN]" if the task is broad, architectural, or involves creating/modifying many files or an entire project (e.g., "create a complete Express API", "migrate this project to TypeScript").' },
          { role: 'user' as const, content: expanded }
        ];
        
        this.post(webview, { type: 'chatStart' });
        this.post(webview, { type: 'agentThinking', text: '' });
        
        let decisionRaw = '';
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(new Error("Router timeout (30s)")), 30000);

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
          operationLogger.log('chat', 'Routing: Conversational intent detected -> switching to toolless mode');
          await this.streamChat(webview, active, expanded, rawText, messageId);
          return;
        }
        if (decisionUpper.includes('[PLAN]')) {
          operationLogger.log('chat', 'Routing: Large task detected -> dynamic switch to Plan mode');
          await this.runPlanMode(webview, active, expanded);
          return;
        }
      } catch (e) {
        this.post(webview, { type: 'chatChunk', text: `\n*(Router error: ${e instanceof Error ? e.message : e} - Falling back to tools)*` });
        this.post(webview, { type: 'chatDone' });
        operationLogger.log('chat', `Router error, fallback to tools: ${e}`);
      }
    }

    // By default chat is agentic: the model has access to its tools
    // (file creation/editing, terminal...) instead of responding in plain text.
    const chatMode = this.getOptimization().chatMode ?? 'agent';
    if (chatMode === 'agent' || mode === 'Automatic') {
      const recentHistory = this.history.slice(-10);
      const finalText = await this.runAgent(webview, active, expanded, undefined, recentHistory, { messageId });
      this.recordUserTurn(webview, { role: 'user', content: this.maybeScrub(expanded, active.providerName) }, messageId);
      if (finalText) this.history.push({ role: 'assistant', content: finalText });
      this.getSessions()?.updateCurrent(this.history);
      return;
    }

    await this.streamChat(webview, active, expanded, rawText, messageId);
  }

  private startNewSession(webview: vscode.Webview): void {
    const store = this.getSessions();
    store?.startNew();
    this.history = [];
    this.historyIndexByMessageId.clear();
    this.messageCheckpoints.clear();
    this.tokenCounter.reset();
    this.persistTokenState();
    this.postTokens(webview);
    this.post(webview, { type: 'sessionStarted' });
    this.post(webview, { type: 'todoUpdate', items: [] });
    operationLogger.log('session', 'New chat session started');
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
        placeHolder: 'Select a conversation to resume'
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
      this.post(webview, { type: 'chatError', error: `Session not found: ${arg}` });
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
    this.historyIndexByMessageId.clear();
    this.messageCheckpoints.clear();
    this.tokenCounter.reset();
    this.persistTokenState();
    this.postTokens(webview);
    this.post(webview, { type: 'sessionResumed', title: session.title });
    operationLogger.log('session', `Session resumed: ${session.title}`);
  }

  /** Direct streaming chat (spec §3.2) + response cache. */
  private async streamChat(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    expandedText: string,
    rawText: string,
    messageId?: string
  ): Promise<void> {
    const { provider, providerName, model } = active;
    const outgoing = this.maybeScrub(expandedText, providerName);

    this.recordUserTurn(webview, { role: 'user', content: outgoing }, messageId);
    const messages: ChatMessage[] = [{ role: 'system', content: this.buildSystemPrompt() }, ...this.history];
    const inputTokens = estimateTokens(messages.map(m => m.content).join(' '));

    // Response cache (spec §3.2)
    const cacheKey = ResponseCache.keyFor(model, messages);
    const cached = this.responseCache.get(cacheKey);
    if (cached) {
      this.history.push({ role: 'assistant', content: cached });
      this.post(webview, { type: 'chatStart' });
      this.post(webview, { type: 'chatChunk', text: cached });
      this.post(webview, { type: 'chatDone' });
      operationLogger.log('chat', 'Response served from cache', 'success');
      return;
    }

    let assembled = '';
    const started = Date.now();
    this.post(webview, { type: 'chatStart' });

    // Specialized agent suggestion (spec §5.1 — auto-detection)
    const suggestion = suggestAgent(rawText, this.getConfiguredAgents());
    if (suggestion) {
      this.post(webview, {
        type: 'chatChunk',
        text: `> 💡 *Tip: ${suggestion.mention} (${suggestion.label}) could help — mention it to activate it.*\n\n`
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
        operationLogger.log('chat', `Model response ${model} (${outputTokens} tokens)`, 'success');
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
        operationLogger.log('chat', `Model error: ${err.message}`, 'error');
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

  /** Per-tool policy (Settings > Tools) — `{}` if config unreadable. */
  private getToolPolicies(): Record<string, ToolPolicy> {
    try {
      // update_todo_list has no side effects (display only): never HITL friction,
      // unless the user has explicitly reconfigured it in Settings.
      return { update_todo_list: 'auto', ...getConfigManager().getConfig().toolPolicies };
    } catch {
      return { update_todo_list: 'auto' };
    }
  }

  /** Active MCP tools by connected server — connects servers if needed. */
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
    
    // MCP first: builtins duplicated by a connected server are hidden.
    const activeMcpTools = await this.getActiveMcpTools();
    for (const tool of createBuiltinTools()) {
      if (policies[tool.name] === 'excluded') continue;
      if (isBuiltinShadowed(tool.name, activeMcpTools)) continue;
      tool.origin = 'builtin';
      registry.register(tool);
    }

    // Custom tools from jarvis-tools/ (spec §5.1)
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      for (const tool of await loadCustomTools(workspaceFolder)) {
        if (policies[tool.name] === 'excluded') continue;
        tool.origin = 'custom';
        registry.register(tool);
        operationLogger.log('tools', `Custom tool loaded: ${tool.name}`);
      }
    }

    // Tools from configured MCP servers (Settings tab)
    const mcp = this.getMcpManager();
    if (mcp) {
      for (const tool of mcp.toToolDefinitions()) {
        tool.origin = 'mcp';
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
        operationLogger.log('tool-result', `${tool}: ${success ? 'ok' : 'failed'}`, success ? 'success' : 'error');
        
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
        // Notify the webview of pending changes after each tool
        if (this.changeTracker.pendingCount > 0) {
          this.notifyPendingChanges(webview);
        }
      },
      onFinal: text => this.post(webview, { type: 'agentFinalChunk', chunk: text }),
      onFinalChunk: chunk => this.post(webview, { type: 'agentFinalChunk', chunk }),
      onTodoUpdate: items => this.post(webview, { type: 'todoUpdate', items })
    };
  }

  private buildOrchestrator(
    active: { provider: IModelProvider; providerName: string },
    registry: ToolRegistry,
    persona?: string,
    promptOptions?: import('./agent/orchestrator.js').AgentPromptOptions
  ): AgentOrchestrator {
    const maxIterations = this.getOpt(this.getOptimization().agentMaxIterations, 'agent.maxIterations', 100);
    return new AgentOrchestrator(active.provider, registry, {
      maxIterations,
      hitl: this.hitl,
      scrub: text => this.maybeScrub(text, active.providerName),
      systemPrompt: buildAgentSystemPrompt(registry, persona, this.getPromptExtras() || undefined, promptOptions),
      changeTracker: this.changeTracker,
      toolPolicies: this.getToolPolicies(),
      workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      abortSignal: this.currentAbortController?.signal,
      onFileEdited: filePath => this.maybeAutoOpen(filePath)
    });
  }

  /**
   * Opens the edited file in the "preview" tab (reused on each subsequent edit,
   * no tab accumulation) so the user immediately sees the inline decorations.
   * Controllable via `jarvis.autoOpen.mode` (config or VS Code setting).
   */
  private maybeAutoOpen(filePath: string): void {
    const mode = this.getOpt(this.getOptimization().autoOpenMode, 'autoOpen.mode', 'always');
    if (mode === 'never') return;
    if (mode === 'strict-hitl-only' && this.hitl.getMode() !== 'strict') return;
    vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: true, preserveFocus: false })
      .then(undefined, () => { /* file may already be closed/deleted — ignore */ });
  }

  /** Full agentic loop (spec §4). */
  private async runAgent(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    task: string,
    persona?: string,
    history?: ChatMessage[],
    options: { kind?: import('../../frontend/shared/types.js').MessageKind, isSmallModel?: boolean, allowedToolPrefixes?: string[], planOnly?: boolean, messageId?: string } = {}
  ): Promise<string | void> {
    this.post(webview, { type: 'chatStart' });
    this.currentAbortController = new AbortController();

    // Ensure the .jarvisignore file is generated as early as possible in the workspace via the async VS Code API
    try { await new SandboxManager().ensureIgnoreFile(); } catch { /* ignore */ }

    // RAG context augmentation (spec §5.2): relevant code snippets added to the prompt.
    task = await this.augmentTaskWithCodeContext(task);

    let result;
    const started = Date.now();
    const inputTokens = estimateTokens(task);

    try {
      const baseRegistry = await this.getToolRegistry();
      const registry = baseRegistry.clone();
      
      if (options.isSmallModel) {
        operationLogger.log('agent', 'Small model detected: restricting tools to essential file operations.');
        registry.restrictTo([
          'create_new_file',
          'edit_existing_file',
          'single_find_and_replace',
          'read_file',
          'run_terminal_command'
        ]);
      }

      if (options.allowedToolPrefixes?.length) {
        registry.restrictTo(options.allowedToolPrefixes);
      }

      const orchestrator = this.buildOrchestrator(active, registry, persona, options.planOnly ? { planOnly: true } : undefined);

      // Checkpoint avant action agentique (spec §6.2)
      const checkpoint = await this.getCheckpoints()
        .createCheckpoint('action', task.slice(0, 40))
        .catch(err => this.reportCheckpointFailure(err));
      if (checkpoint && options.messageId) {
        this.messageCheckpoints.set(options.messageId, checkpoint);
        this.post(webview, { type: 'checkpointLinked', messageId: options.messageId, checkpointId: checkpoint.id });
      }

      result = await orchestrator.run(task, history || [], this.agentEvents(webview));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAbort = msg.includes('aborted');
      result = { 
        success: false, 
        finalText: '', 
        iterations: 0, 
        error: isAbort ? "Generation cancelled by user." : `Internal error: ${msg}` 
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
      const isAbort = result.error?.includes("cancelled by user");
      if (!isAbort) {
        this.post(webview, { type: 'chatError', error: result.error ?? 'Agent failure' });
      }
      return;
    }

    this.post(webview, {
      type: 'agentFinal',
      text: '', // Already streamed via onFinal Chunk
      kind: options?.kind,
      badges: [{ icon: '✅', label: `Completed in ${result.iterations} iteration(s)`, variant: 'success' }]
    });
    this.notifyPendingChanges(webview);
    this.post(webview, { type: 'chatDone' });

    return result.finalText;
  }

  /**
   * /init command: initializes git if needed, analyzes the project and generates JARVIS.md
   * (similar to `claude init`). Requires Phase 4 (getJarvisMdText/refreshJarvisMd) to be in place
   * so that the generated file is immediately taken into account by subsequent prompts.
   */
  private async runInit(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string }
  ): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      this.post(webview, { type: 'chatError', error: 'No workspace folder open. Open a folder before running /init.' });
      return;
    }

    if (!(await this.ensureGitInitialized(workspaceFolder))) {
      this.post(webview, { type: 'chatError', error: 'Initialization cancelled (git init required).' });
      return;
    }
    await this.enableGitMcpBuiltin(webview);

    let existing = '';
    try {
      existing = await readFileTool('JARVIS.md');
    } catch {
      // Absent — normal behavior, no error to report.
    }
    if (existing.trim()) {
      const choice = await vscode.window.showWarningMessage(
        'JARVIS.md already exists. Regenerating will replace its current content. Continue?',
        { modal: true },
        'OK'
      );
      if (choice !== 'OK') {
        this.post(webview, { type: 'chatError', error: 'Initialization cancelled: JARVIS.md preserved.' });
        return;
      }
    }

    const task =
      'Analyze this project (package.json or equivalent, folder structure, entry points, conventions) ' +
      'then create/replace the JARVIS.md file at the workspace root with the following sections: ' +
      '"## Project Overview" (a paragraph summarizing the project), ' +
      '"## Build & Test Commands" (the exact detected commands), ' +
      '"## Architecture" (key folders/modules and their role), ' +
      '"## Conventions" (code style, imports, naming observed), ' +
      '"## Notes for Agents" (specific points useful to a code agent for this project). ' +
      'Stay concise and actionable — no generic filler.';

    await this.runAgent(webview, active, task, INIT_SYSTEM_PROMPT);
    void this.refreshJarvisMd();
  }

  /** Auto-TDD loop (spec §3.3). */
  private async runTDD(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    task: string
  ): Promise<void> {
    const opt = this.getOptimization();
    const maxAttempts = this.getOpt(opt.tddMaxAttempts, 'tdd.maxAttempts', 5);
    const testCommand = this.getOpt(opt.tddTestCommand, 'tdd.testCommand', 'npm test');
    const timeout = this.getOpt(opt.terminalTimeout, 'terminal.timeout', 30000);

    await this.getCheckpoints().createCheckpoint('workflow', `tdd-${task.slice(0, 30)}`).catch(err => this.reportCheckpointFailure(err));

    const loop = new AutoTDDLoop(active.provider, {
      writeFile: async (p, content) => {
        const approval = await this.hitl.checkApproval('write_file', { path: p });
        if (!approval.granted) throw new Error(`Write refused: ${p}`);
        await writeFileTool(p, content);
      },
      runCommand: async (command, t) => {
        const approval = await this.hitl.checkApproval('terminal', { command });
        if (!approval.granted) {
          return { success: false, stdout: '', stderr: 'Command refused by user', timedOut: false };
        }
        const result = await executeTerminalCommand(command, { timeout: t });
        return { success: result.success, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut };
      }
    });

    const started = Date.now();
    const result = await loop.run(task, { maxAttempts, testCommand, timeout }, {
      onAttemptStart: (attempt, max) =>
        this.post(webview, { type: 'workflowStep', step: `Tentative TDD ${attempt}`, index: attempt, total: max }),
      onFilesGenerated: async files => {
        this.post(webview, {
          type: 'agentTool',
          tool: 'create_new_file',
          args: { files: files.map(f => f.path) }
        });
        // Open the first created file automatically
        if (files.length > 0) {
          const firstFile = files[0];
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (workspaceFolder) {
            const resolvedPath = resolveWorkspacePath(workspaceFolder, firstFile.path);
            try {
              const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(resolvedPath));
              await vscode.window.showTextDocument(doc, { preview: false });
            } catch (err) {
              operationLogger.log('tdd', `Failed to open file ${firstFile.path}: ${err instanceof Error ? err.message : err}`, 'error');
            }
          }
        }
      },
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
      ? `✅ **Auto-TDD successful** in ${result.attempts} attempt(s).\n\nModified files:\n${result.filesWritten.map(f => `- \`${f}\``).join('\n')}\n\n${result.explanation ?? ''}`
      : `❌ **Auto-TDD failed** after ${result.attempts} attempt(s): ${result.error}\n\nLast test output:\n\`\`\`\n${result.lastTestOutput.slice(-1500)}\n\`\`\``;

    this.post(webview, {
      type: 'agentFinal',
      text: summary,
      badges: [
        result.success
          ? { icon: '✅', label: 'Tests passing', variant: 'success' }
          : { icon: '❌', label: 'Failure', variant: 'error' }
      ]
    });
  }

  /** Predefined sequential workflows (spec §5.2). */
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
      await this.getCheckpoints().createCheckpoint('workflow', `${workflowId}-${task.slice(0, 30)}`).catch(err => this.reportCheckpointFailure(err));
    }, this.getConfiguredWorkflows());

    // Known steps in advance (except for `dynamic` workflow) → pre-filled TODO checklist
    // even before the first step starts (spec §5 — free visibility on /workflow).
    const workflowDef = this.getConfiguredWorkflows().find(w => w.id === workflowId);
    const todos: TodoItem[] = (workflowDef?.steps ?? []).map((s, i) => ({
      id: `step-${i}`,
      content: s.name,
      status: 'pending'
    }));
    if (todos.length > 0) this.post(webview, { type: 'todoUpdate', items: todos });

    const started = Date.now();
    const result = await runner.run(workflowId, task, {
      ...this.agentEvents(webview),
      onStepStart: (step, index, total) => {
        this.post(webview, { type: 'workflowStep', step, index, total });
        if (todos[index - 1]) {
          todos[index - 1].status = 'in_progress';
          this.post(webview, { type: 'todoUpdate', items: todos });
        }
      },
      onStepDone: (step, stepResult) => {
        const item = todos.find(t => t.content === step);
        if (item) {
          item.status = stepResult.success ? 'completed' : 'pending';
          this.post(webview, { type: 'todoUpdate', items: todos });
        }
      }
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
        text: '', // Already streamed via onFinal Chunk
        badges: [{ icon: '✅', label: `${result.steps.length} steps`, variant: 'success' }]
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
            output += `\n\n⚠️ ${foundSecrets.length} secret(s) hidden before display.`;
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
            operationLogger.log('write_file', `${filePath} — refused`, 'blocked');
            break;
          }
          await writeFileTool(filePath, content);
          void this.indexer.reindexFile(filePath);
          output = `✅ Written: ${filePath}`;
          operationLogger.log('write_file', filePath, 'success');
          break;
        }
        case 'run': {
          const approval = await this.hitl.checkApproval('terminal', { command: arg });
          if (!approval.granted) {
            output = `❌ ${approval.reason}`;
            operationLogger.log('terminal', `${arg} — refused`, 'blocked');
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

  // A checkpoint that fails silently (`.catch(() => null)`) may leave
  // the user's files only in the git stash without them knowing — so we notify
  // systematically instead of swallowing the error.
  private reportCheckpointFailure(err: unknown): null {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Jarvis: checkpoint failed — ${msg}`);
    operationLogger.log('checkpoint', msg, 'error');
    return null;
  }

  private async onRollback(webview: vscode.Webview, id: string): Promise<void> {
    // Re-resolves the ref by stable id (never trusts a ref the panel captured
    // on its last refresh — it goes stale the moment a newer checkpoint exists).
    const { result, checkpoints } = await this.getCheckpoints().listAndRestore(id);
    if (result.success) {
      vscode.window.showInformationMessage(`Jarvis: rollback completed (${id})`);
      operationLogger.log('rollback', id, 'success');
    } else {
      vscode.window.showErrorMessage(`Jarvis: rollback failed — ${result.error}`);
      operationLogger.log('rollback', `${id}: ${result.error}`, 'error');
    }
    this.post(webview, { type: 'checkpoints', checkpoints });
  }

  // `/rollback` chat shortcut: cancels all file modifications
  // made since the last message (last 'action'/'workflow' checkpoint).
  private async onRollbackLastMessage(webview: vscode.Webview): Promise<void> {
    const result = await this.getCheckpoints().rollbackToLastCheckpoint();
    if (result.success) {
      operationLogger.log('rollback', 'last-message', 'success');
      this.post(webview, { type: 'chatChunk', text: "Changes cancelled: the project has been restored to the state before the last message." });
    } else {
      operationLogger.log('rollback', `last-message: ${result.error}`, 'error');
      this.post(webview, { type: 'chatChunk', text: `Rollback failed: ${result.error}` });
    }
    this.post(webview, { type: 'chatDone' });
    await this.onListCheckpoints(webview);
  }

  /**
   * Truncates the transcript to right BEFORE `messageId`: that message (and
   * everything after it) is discarded from history, so the frontend can put
   * its text back in the input box for the user to edit/resend — it's an
   * "edit & resend" fork, not a "keep this message, discard the rest" one.
   * The full pre-fork conversation is preserved intact as its own past
   * session (reachable via `/resume`). Never touches files on disk.
   */
  private performFork(webview: vscode.Webview, messageId: string): boolean {
    const idx = this.historyIndexByMessageId.get(messageId);
    if (idx === undefined || idx >= this.history.length) {
      vscode.window.showErrorMessage('Jarvis: this message is no longer available to fork from.');
      return false;
    }

    const store = this.getSessions();
    if (!store) {
      vscode.window.showErrorMessage('Jarvis: open a workspace folder to fork conversations.');
      return false;
    }

    const originalTitle = store.getCurrent().title;
    const truncated = this.history.slice(0, idx);
    // forkCurrent syncs the pre-fork snapshot (this.history, in full) to the
    // current session AND seeds the new one in a single write — no separate
    // updateCurrent() call needed even though this.history may have grown
    // since the last turn-completion write.
    const forked = store.forkCurrent(this.history, truncated, originalTitle ? `Fork of ${originalTitle}` : undefined);

    this.history = truncated;
    for (const [mid, i] of this.historyIndexByMessageId) {
      if (i >= idx) this.historyIndexByMessageId.delete(mid);
    }
    for (const mid of this.messageCheckpoints.keys()) {
      if (!this.historyIndexByMessageId.has(mid)) this.messageCheckpoints.delete(mid);
    }

    // Fork keeps real prior context (unlike /resume's summarization) — the
    // token gauge is not reset, it keeps reflecting actual spend so far.
    this.post(webview, { type: 'forked', messageId, title: forked.title });
    operationLogger.log('session', `Conversation forked from message ${messageId}`, 'success');
    return true;
  }

  private onForkConversation(webview: vscode.Webview, messageId: string): void {
    this.performFork(webview, messageId);
  }

  private async onRewindToMessage(webview: vscode.Webview, messageId: string): Promise<boolean> {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }

    const checkpoint = this.messageCheckpoints.get(messageId);
    if (!checkpoint) {
      vscode.window.showErrorMessage('Jarvis: no checkpoint associated with this message.');
      return false;
    }

    // listAndRestore fetches the checkpoint list once and returns it alongside
    // the result — `git stash apply` never mutates the stash list, so that
    // same list can refresh the Checkpoints panel without a second `git stash
    // list` shell-out.
    const { result, checkpoints } = await this.getCheckpoints().listAndRestore(checkpoint.id);
    if (result.success) {
      vscode.window.showInformationMessage('Jarvis: code rewound to before this message.');
      operationLogger.log('rewind', messageId, 'success');
    } else {
      vscode.window.showErrorMessage(`Jarvis: rewind failed — ${result.error}`);
      operationLogger.log('rewind', `${messageId}: ${result.error}`, 'error');
    }
    this.post(webview, { type: 'checkpoints', checkpoints });
    return result.success;
  }

  private async onForkAndRewind(webview: vscode.Webview, messageId: string): Promise<void> {
    // Rewind first: performFork prunes messageId's checkpoint link once the
    // message is excluded from history, so the lookup inside onRewindToMessage
    // would otherwise come up empty if fork ran first. Only fork if the
    // rewind actually succeeded — otherwise the chat would move on as if the
    // code had been restored when it wasn't, leaving the two inconsistent.
    const rewound = await this.onRewindToMessage(webview, messageId);
    if (!rewound) return;
    this.performFork(webview, messageId);
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

  /** Triggers /init from the command palette (`jarvis.init`). */
  public async triggerInit(): Promise<void> {
    this.focus();
    if (!this._view?.webview) {
      vscode.window.showInformationMessage('Jarvis: open the sidebar, then run /init from the chat.');
      return;
    }
    const webview = this._view.webview;
    this.post(webview, { type: 'injectUserMessage', text: '/init' });
    await this.onChatMessage(webview, '/init', 'Automatic');
  }

  public getIndexer(): WorkspaceIndexer {
    return this.indexer;
  }

  /** Refreshes the indexing status displayed in Settings (Workspaces section). */
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
      placeHolder: 'Example: Translate these comments to English...',
      prompt: 'What should I modify in this code block?'
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
      { location: vscode.ProgressLocation.Notification, title: 'Jarvis: editing in progress...' },
      async () => {
        try {
          const task = `Modify the file \`${filePath}\` (Lines ${startLine} to ${endLine}) to fulfill the following request:\n"${prompt}"\n\nTarget code:\n\`\`\`\n${selectedText}\n\`\`\``;
          
          if (this._view?.webview) {
            // Cmd+K is a native VS Code command, not the chat box — there's no
            // frontend-generated id to correlate against, so the backend mints one
            // here and hands it down via `inlinePrompt` for the frontend to reuse
            // instead of minting its own. (Intentional asymmetry vs. the chat-box
            // flow, where the frontend always owns the id.)
            const messageId = randomUUID();
            // Display the prompt inline in the chat (the backend task is never posted to
            // webview otherwise) BEFORE recordUserTurn's `forkable` confirmation — the
            // frontend can only attach that flag to a message bubble that already exists.
            this.post(this._view.webview, {
              type: 'inlinePrompt',
              id: messageId,
              prompt,
              file: filePath,
              startLine,
              endLine
            });
            this.recordUserTurn(this._view.webview, { role: 'user', content: task }, messageId);
            this.getSessions()?.updateCurrent(this.history);
            await this.runAgent(this._view.webview, active, task, "INLINE EDIT MODE: Edit only the requested section in the file using your tools. Be direct, no unnecessary explanations.", undefined, { messageId });
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
      console.warn('ModelConfigManager unavailable:', error);
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
      // We save to .vscode/jarvis-sessions.json in the main workspace
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
                   media-src ${webview.cspSource};
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
    console.log('JarvisExtension: initializing');
    this.setupStatusBar();
    this.setupLogging();

    const registration = vscode.window.registerWebviewViewProvider(
      JarvisSidebarProvider.viewType,
      this.sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
    this.context.subscriptions.push(registration);

    // Registration of integrated diff review (CodeLenses + decorations + commands)
    const codeLensProvider = new JarvisCodeLensProvider(() => this.sidebarProvider.getChangeTracker());
    const decorationProvider = new DiffDecorationProvider(() => this.sidebarProvider.getChangeTracker());
    this.context.subscriptions.push(
      vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider),
      decorationProvider,
      // Reapply green/red colors when the displayed editor changes.
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

    // Session checkpoint (spec §6.2). A failure here means that the
    // user's files remained in the git stash without being
    // restored to disk — never swallow this error silently.
    if (vscode.workspace.workspaceFolders?.length) {
      void new CheckpointManager().createCheckpoint('session', 'session-start').catch(err => {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Jarvis: checkpoint failed — ${msg}`);
        operationLogger.log('checkpoint', msg, 'error');
        return null;
      });
    }

    // Reload patterns when .jarvisignore is manually edited in
    // the editor (Add/Remove/Generate commands already update the sandbox
    // themselves; this watcher covers manual file editing, otherwise the
    // in-memory sandbox remains stale until extension reload and continues
    // showing files that should be ignored).
    if (vscode.workspace.workspaceFolders?.length) {
      const watcher = vscode.workspace.createFileSystemWatcher('**/.jarvisignore');
      const reload = () => { void getSandbox().reloadIgnorePatterns(); };
      watcher.onDidChange(reload);
      watcher.onDidCreate(reload);
      watcher.onDidDelete(reload);
      this.context.subscriptions.push(watcher);
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

  public runInit(): Promise<void> {
    return this.sidebarProvider.triggerInit();
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
        { title: 'Jarvis Checkpoints — select for rollback' }
      );
      if (pick) {
        // Re-resolves by the stable id (`detail`), not the ref shown in `description`
        // — a ref captured when the picker opened can go stale by the time it's picked.
        const result = await manager.restoreToCheckpoint(pick.detail ?? '');
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

  /** "Jarvis: Generate .jarvisignore" command. */
  public async generateJarvisignore(): Promise<void> {
    try {
      const sandbox = new SandboxManager();
      await sandbox.regenerateIgnoreFile();
      setSandbox(sandbox);
      vscode.window.showInformationMessage('Jarvis: .jarvisignore regenerated with recommended patterns.');
      operationLogger.log('jarvisignore', 'regenerated', 'success');
    } catch (err) {
      vscode.window.showErrorMessage(`Jarvis: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** "Jarvis: Add to .jarvisignore" command (selected file or input). */
  public async addToJarvisignore(uri?: vscode.Uri): Promise<void> {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) throw new Error('Workspace not found');

      let pattern: string | undefined;
      if (uri) {
        pattern = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      } else {
        pattern = await vscode.window.showInputBox({
          title: 'Pattern to add to .jarvisignore',
          placeHolder: 'e.g., secrets/ or *.pem'
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

  /** "Jarvis: Remove from .jarvisignore" command. */
  public async removeFromJarvisignore(): Promise<void> {
    try {
      const sandbox = new SandboxManager();
      const patterns = sandbox.getIgnorePatterns();
      if (patterns.length === 0) {
        vscode.window.showInformationMessage('Jarvis: .jarvisignore is empty.');
        return;
      }
      const pick = await vscode.window.showQuickPick(patterns, {
        title: 'Pattern to remove from .jarvisignore'
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

  /** "Jarvis: Index Workspace" command (RAG). */
  public async indexWorkspace(): Promise<void> {
    const indexer = this.sidebarProvider.getIndexer();
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Jarvis: indexing workspace...' },
      async progress => {
        const count = await indexer.indexWorkspace((done, total) => {
          progress.report({ message: `${done}/${total} files` });
        });
        vscode.window.showInformationMessage(`Jarvis: ${count} files indexed for RAG search.`);
        // Refreshes the status displayed in Settings > Workspaces if the sidebar is open
        // (until now only the webview → indexWorkspace path notified the webview).
        this.sidebarProvider.notifyIndexStatus();
      }
    );
  }

  public async inlineEdit(): Promise<void> {
    await this.sidebarProvider.inlineEdit();
  }
}
