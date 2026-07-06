import * as vscode from 'vscode';
import { ModelConfigManager } from '../config/model-config-manager.js';
import { getConfigManager, normalizeConfig, type JarvisConfig } from '../config/config-manager.js';
import { ChatMessage, IModelProvider } from '../models/abstract.js';
import { HITLManager, HITLMode } from '../services/hitl.js';
import { CheckpointManager } from '../services/checkpoint.js';
import { AnalyticsCollector } from '../services/analytics.js';
import { TokenCounter, TokenUsage, estimateTokens } from '../services/token-counter.js';
import { ResponseCache } from '../services/response-cache.js';
import { AutoTDDLoop } from '../services/tdd-loop.js';
import { detectAgentMention, suggestAgent, getAgents } from '../services/agents.js';
import { WorkflowRunner, getWorkflows } from '../services/workflows.js';
import { loadRules, renderRules } from '../services/rules.js';
import { WorkspaceIndexer } from '../services/context/indexer.js';
import { expandMentions } from '../services/context/mentions.js';
import { operationLogger } from '../services/logger.js';
import { SecretScrubber } from './utils/scrubber.js';
import { SandboxManager } from './utils/sandbox.js';
import { AgentOrchestrator, buildAgentSystemPrompt, AgentEvents } from './agent/orchestrator.js';
import { ToolRegistry, createBuiltinTools } from './agent/tool-registry.js';
import { loadCustomTools } from './agent/custom-tools.js';
import {
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  setSandbox
} from './mcp/tools/fileSystem.js';
import { executeTerminalCommand } from './mcp/tools/terminal.js';
import { McpManager } from './mcp/manager.js';

const BASE_SYSTEM_PROMPT =
  'Tu es Jarvis, un assistant de code agentique intégré à VS Code. ' +
  'Réponds de manière concise et technique. Utilise le Markdown pour formater ton code.';

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

  /** Prompt système du chat direct, rules utilisateur incluses (spec §5.2). */
  private buildSystemPrompt(): string {
    const rules = this.getRulesText();
    return rules ? `${BASE_SYSTEM_PROMPT}\n\n${rules}` : BASE_SYSTEM_PROMPT;
  }

  private getMcpManager(): McpManager | null {
    if (this.mcpManager) return this.mcpManager;
    try {
      this.mcpManager = new McpManager();
      return this.mcpManager;
    } catch (err) {
      console.warn('McpManager indisponible:', err);
      return null;
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
          await this.onChatMessage(webview, message.text);
        }
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
        }
        break;
      case 'setModel':
        if (typeof message.model === 'string') {
          await this.onSetModel(webview, message.model);
        }
        break;
      case 'getSettings':
        this.onGetSettings(webview);
        break;
      case 'updateSettings':
        if (message.config && typeof message.config === 'object') {
          await this.onUpdateSettings(webview, message.config as JarvisConfig);
        }
        break;
      case 'getMcpStatus':
        await this.onGetMcpStatus(webview);
        break;
      case 'indexWorkspace':
        await this.indexWorkspaceInBackground();
        break;
    }
  }

  private onWebviewReady(webview: vscode.Webview): void {
    const configManager = this.getModelConfigManager();
    const model = configManager?.getEffectiveModel() ?? null;
    const models = configManager?.getAvailableModels() ?? [];
    const needsSetup = !model || models.length === 0;
    this.tokenCounter.setLimit(configManager?.getContextLength(model) ?? 32768);

    this.post(webview, {
      type: 'status',
      text: needsSetup ? 'No model configured — open Settings' : `Connected — model: ${model}`,
      success: !needsSetup,
      needsSetup,
      models: models.map(m => m.name),
      model: model ?? ''
    });
    this.postTokens(webview);
    this.postCapabilities(webview);

    // Background RAG indexing (spec §5.2)
    void this.indexWorkspaceInBackground();
  }

  /** Listes dynamiques (agents, workflows) pour l'autocomplétion du chat. */
  private postCapabilities(webview: vscode.Webview): void {
    this.post(webview, {
      type: 'capabilities',
      agents: this.getConfiguredAgents().map(a => ({ mention: a.mention, label: a.label })),
      workflows: this.getConfiguredWorkflows().map(w => ({ id: w.id, label: w.label }))
    });
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
    this.post(webview, {
      type: 'tokens',
      usage,
      tokensUsed: usage.used,
      tokensLimit: usage.limit
    });
    this.onTokensChanged?.(usage);
  }

  private recordRequest(webview: vscode.Webview, model: string, inputTokens: number, outputTokens: number): void {
    this.tokenCounter.addRequest(model, inputTokens, outputTokens);
    this.postTokens(webview);
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

  /** Envoie la config globale brute au webview pour édition dans l'onglet Settings. */
  private onGetSettings(webview: vscode.Webview): void {
    let config: JarvisConfig;
    let needsSetup = true;
    try {
      config = getConfigManager().getGlobalConfig();
      needsSetup = !config.models.default && Object.keys(config.models.providers).length === 0;
    } catch (err) {
      operationLogger.log('config', `getSettings échoué: ${err instanceof Error ? err.message : err}`, 'error');
      config = normalizeConfig(null);
    }
    this.post(webview, { type: 'settings', config, needsSetup });
  }

  /** Persiste la config éditée (scope global) puis ré-instancie providers + status. */
  private async onUpdateSettings(webview: vscode.Webview, incoming: JarvisConfig): Promise<void> {
    try {
      const config = normalizeConfig(incoming);
      await getConfigManager().writeGlobal(config);
      const configManager = this.getModelConfigManager();
      configManager?.refresh();
      this.toolRegistry = null; // sera reconstruit avec les tools MCP à jour
      await this.mcpManager?.reload().catch(() => undefined);
      this.postCapabilities(webview);
      const model = configManager?.getEffectiveModel() ?? null;
      this.tokenCounter.setLimit(configManager?.getContextLength(model) ?? 32768);
      operationLogger.log('config', 'Settings updated', 'success');
      this.post(webview, { type: 'settingsSaved', ok: true });
      this.post(webview, { type: 'settings', config, needsSetup: !model });
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

  private async indexWorkspaceInBackground(): Promise<void> {
    if (this.indexer.isIndexing) return;
    try {
      const count = await this.indexer.indexWorkspace();
      operationLogger.log('rag', `Indexation terminée: ${count} fichiers`, 'success');
    } catch (err) {
      operationLogger.log('rag', `Indexation échouée: ${err instanceof Error ? err.message : err}`, 'error');
    }
  }

  private getActiveProvider(): { provider: IModelProvider; providerName: string; model: string } | null {
    const configManager = this.getModelConfigManager();
    if (!configManager) return null;
    const model = configManager.getEffectiveModel();
    if (!model) return null;
    const providerName = configManager.getProviderNameForModel(model);
    if (!providerName) return null;
    const provider = configManager.getProvider(providerName);
    if (!provider) return null;
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

  private async onChatMessage(webview: vscode.Webview, rawText: string): Promise<void> {
    // Commandes outils déterministes (@read, @list, @write, @run)
    if (/^@(read|list|write|run)\b/.test(rawText)) {
      await this.handleToolCommand(webview, rawText);
      return;
    }

    // Expansion des mentions @file: / @docs: (spec Phase 4)
    const { expanded } = await expandMentions(rawText, {
      readFile: p => readFileTool(p),
      searchDocs: q => this.indexer.searchDocs(q)
    });

    const active = this.getActiveProvider();
    if (!active) {
      this.post(webview, {
        type: 'chatError',
        error: 'No model configured. Open Settings to add a provider and API key.',
        needsSetup: true
      });
      return;
    }

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
        searchDocs: q => this.indexer.searchDocs(q)
      });
      await this.runAgent(webview, active, task, mention.agent.systemPrompt);
      return;
    }

    await this.streamChat(webview, active, expanded, rawText);
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

    await provider.sendPromptStream(
      messages,
      chunk => {
        assembled += chunk;
        this.post(webview, { type: 'chatChunk', text: chunk });
      },
      () => {
        this.history.push({ role: 'assistant', content: assembled });
        this.responseCache.set(cacheKey, assembled);
        const outputTokens = estimateTokens(assembled);
        this.recordRequest(webview, model, inputTokens, outputTokens);
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
        this.post(webview, { type: 'chatError', error: err.message });
        operationLogger.log('chat', `Erreur du modèle: ${err.message}`, 'error');
        this.getAnalytics()?.trackAction({
          type: 'chat',
          model,
          inputTokens,
          outputTokens: 0,
          duration: (Date.now() - started) / 1000,
          status: 'error'
        });
      }
    );
  }

  private async getToolRegistry(): Promise<ToolRegistry> {
    if (this.toolRegistry) return this.toolRegistry;
    const registry = new ToolRegistry();
    for (const tool of createBuiltinTools()) {
      registry.register(tool);
    }
    // Outils personnalisés depuis jarvis-tools/ (spec §5.1)
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceFolder) {
      for (const tool of await loadCustomTools(workspaceFolder)) {
        registry.register(tool);
        operationLogger.log('tools', `Outil personnalisé chargé: ${tool.name}`);
      }
    }
    // Tools des serveurs MCP configurés (onglet Settings)
    const mcp = this.getMcpManager();
    if (mcp) {
      await mcp.initialize().catch(() => undefined);
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
      onToolCall: (tool, args) => {
        operationLogger.log('tool-call', `${tool} ${JSON.stringify(args)}`);
        this.post(webview, { type: 'agentTool', tool, args });
      },
      onToolResult: (tool, result, success) => {
        operationLogger.log('tool-result', `${tool}: ${success ? 'ok' : 'échec'}`, success ? 'success' : 'error');
        this.post(webview, {
          type: 'agentToolResult',
          tool,
          success,
          summary: result.length > 800 ? result.slice(0, 800) + '…' : result
        });
      }
    };
  }

  private buildOrchestrator(
    active: { provider: IModelProvider; providerName: string },
    registry: ToolRegistry,
    persona?: string
  ): AgentOrchestrator {
    const maxIterations = this.getOpt(this.getOptimization().agentMaxIterations, 'agent.maxIterations', 10);
    return new AgentOrchestrator(active.provider, registry, {
      maxIterations,
      hitl: this.hitl,
      scrub: text => this.maybeScrub(text, active.providerName),
      systemPrompt: buildAgentSystemPrompt(registry, persona, this.getRulesText() || undefined)
    });
  }

  /** Boucle agentique complète (spec §4). */
  private async runAgent(
    webview: vscode.Webview,
    active: { provider: IModelProvider; providerName: string; model: string },
    task: string,
    persona?: string
  ): Promise<void> {
    const registry = await this.getToolRegistry();
    const orchestrator = this.buildOrchestrator(active, registry, persona);
    const started = Date.now();

    // Checkpoint avant action agentique (spec §6.2)
    await this.getCheckpoints().createCheckpoint('action', task.slice(0, 40)).catch(() => null);

    const inputTokens = estimateTokens(task);
    const result = await orchestrator.run(task, [], this.agentEvents(webview));
    const outputTokens = estimateTokens(result.finalText);
    this.recordRequest(webview, active.model, inputTokens, outputTokens);

    this.getAnalytics()?.trackAction({
      type: 'agent',
      model: active.model,
      inputTokens,
      outputTokens,
      duration: (Date.now() - started) / 1000,
      status: result.success ? 'success' : 'error'
    });

    if (result.success) {
      this.post(webview, {
        type: 'agentFinal',
        text: result.finalText,
        badges: [{ icon: '✅', label: `Terminé en ${result.iterations} itération(s)`, variant: 'success' }]
      });
    } else {
      this.post(webview, { type: 'chatError', error: result.error ?? 'Échec de l\'agent' });
    }
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
    task: string
  ): Promise<void> {
    const registry = await this.getToolRegistry();
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
        text: `✅ **Workflow ${workflowId} terminé**\n\n${result.summary}`,
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
      vscode.window.showInformationMessage(`Jarvis: rollback effectué (${ref})`);
      operationLogger.log('rollback', ref, 'success');
    } else {
      vscode.window.showErrorMessage(`Jarvis: rollback échoué — ${result.error}`);
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

    // Jauge de tokens dans la status bar (spec §2.1)
    this.sidebarProvider.onTokensChanged = usage => {
      if (!this.statusBarItem) return;
      const icon = usage.level === 'green' ? '$(hubot)' : usage.level === 'orange' ? '$(warning)' : '$(error)';
      this.statusBarItem.text = `${icon} Jarvis ${usage.percentage}%`;
      this.statusBarItem.tooltip =
        `Jarvis Agent — ${usage.used.toLocaleString()} / ${usage.limit.toLocaleString()} tokens ` +
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
    vscode.window.showInformationMessage('Jarvis: ouvrez l\'onglet Checkpoints dans la barre latérale.');
  }

  public async listCheckpoints(): Promise<void> {
    try {
      const manager = new CheckpointManager();
      const list = await manager.listCheckpoints();
      if (list.length === 0) {
        vscode.window.showInformationMessage('Jarvis: aucun checkpoint disponible.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        list.map(c => ({ label: c.description, description: c.ref, detail: c.id })),
        { title: 'Jarvis Checkpoints — sélectionnez pour rollback' }
      );
      if (pick) {
        const result = await manager.rollback(pick.description ?? '');
        if (result.success) {
          vscode.window.showInformationMessage(`Rollback effectué: ${pick.label}`);
        } else {
          vscode.window.showErrorMessage(`Rollback échoué: ${result.error}`);
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
        vscode.window.showWarningMessage('Jarvis: analytics indisponible (workspace requis).');
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
      vscode.window.showInformationMessage('Jarvis: .jarvisignore régénéré avec les patterns recommandés.');
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
      vscode.window.showInformationMessage(`Jarvis: "${pattern}" ajouté à .jarvisignore.`);
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
        vscode.window.showInformationMessage('Jarvis: .jarvisignore est vide.');
        return;
      }
      const pick = await vscode.window.showQuickPick(patterns, {
        title: 'Pattern à retirer de .jarvisignore'
      });
      if (!pick) return;
      await sandbox.removeIgnorePattern(pick);
      setSandbox(sandbox);
      vscode.window.showInformationMessage(`Jarvis: "${pick}" retiré de .jarvisignore.`);
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
        vscode.window.showInformationMessage(`Jarvis: ${count} fichiers indexés pour la recherche RAG.`);
      }
    );
  }
}
