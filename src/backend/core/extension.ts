import * as vscode from 'vscode';
import { ModelConfigManager } from '../config/model-config-manager.js';
import { ChatMessage } from '../models/abstract.js';
import { HITLManager, HITLMode } from '../services/hitl.js';
import { CheckpointManager } from '../services/checkpoint.js';
import { AnalyticsCollector, estimateTokens } from '../services/analytics.js';
import { SecretScrubber } from './utils/scrubber.js';
import {
  readFileTool,
  writeFileTool,
  listDirectoryTool
} from './mcp/tools/fileSystem.js';
import { executeTerminalCommand } from './mcp/tools/terminal.js';

const SYSTEM_PROMPT =
  'Tu es Jarvis, un assistant de code agentique intégré à VS Code. ' +
  'Réponds de manière concise et technique. Utilise le Markdown pour formater ton code.';

export class JarvisSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'jarvis.sidebarView';

  private _view?: vscode.WebviewView;
  private modelConfigManager: ModelConfigManager | null = null;
  private tokensUsed = 0;
  private contextLength = 32768;
  private history: ChatMessage[] = [];

  private hitl = new HITLManager('moderate');
  private scrubber = new SecretScrubber();
  private checkpoints: CheckpointManager | null = null;
  private analytics: AnalyticsCollector | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

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
      case 'setHitlMode':
        if (typeof message.mode === 'string') {
          this.hitl.setMode(message.mode as HITLMode);
        }
        break;
    }
  }

  private onWebviewReady(webview: vscode.Webview): void {
    const configManager = this.getModelConfigManager();
    const defaultModel = configManager?.getDefaultModel() ?? 'deepseek-coder-v3';
    const models = configManager?.getAvailableModels() ?? [];
    this.contextLength = models[0]?.contextLength ?? 32768;

    this.post(webview, {
      type: 'status',
      text: `✅ Connecté — modèle: ${defaultModel}`,
      success: true
    });
    this.post(webview, {
      type: 'tokens',
      tokensUsed: this.tokensUsed,
      tokensLimit: this.contextLength
    });
  }

  private async onChatMessage(webview: vscode.Webview, text: string): Promise<void> {
    // Slash/at tool commands run deterministically without hitting the model.
    if (text.startsWith('@')) {
      await this.handleToolCommand(webview, text);
      return;
    }

    const configManager = this.getModelConfigManager();
    const providers = configManager?.getConfig().models.providers ?? {};
    const providerName = Object.keys(providers).find(k => providers[k].enabled) ?? 'ollama';
    const provider = configManager?.getProvider(providerName);
    const model = configManager?.getDefaultModel() ?? providerName;

    if (!provider) {
      this.post(webview, {
        type: 'chatError',
        error: 'Aucun provider disponible. Vérifiez jarvis-config.json.'
      });
      return;
    }

    this.history.push({ role: 'user', content: text });
    const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...this.history];

    const inputTokens = estimateTokens(messages.map(m => m.content).join(' '));
    let assembled = '';
    const started = Date.now();

    this.post(webview, { type: 'chatStart' });

    await provider.sendPromptStream(
      messages,
      chunk => {
        assembled += chunk;
        this.post(webview, { type: 'chatChunk', text: chunk });
      },
      () => {
        this.history.push({ role: 'assistant', content: assembled });
        this.tokensUsed += inputTokens + estimateTokens(assembled);
        this.post(webview, { type: 'chatDone' });
        this.post(webview, {
          type: 'tokens',
          tokensUsed: this.tokensUsed,
          tokensLimit: this.contextLength
        });
        this.getAnalytics()?.trackAction({
          type: 'chat',
          model,
          inputTokens,
          outputTokens: estimateTokens(assembled),
          duration: (Date.now() - started) / 1000,
          status: 'success'
        });
      },
      err => {
        this.post(webview, { type: 'chatError', error: err.message });
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
            break;
          }
          await writeFileTool(filePath, content);
          output = `✅ Écrit: ${filePath}`;
          break;
        }
        case 'run': {
          const approval = await this.hitl.checkApproval('terminal', { command: arg });
          if (!approval.granted) {
            output = `❌ ${approval.reason}`;
            break;
          }
          const result = await executeTerminalCommand(arg, {
            onData: chunk => this.post(webview, { type: 'terminalOutput', data: chunk })
          });
          output = `\`\`\`\n${result.stdout}${result.stderr}\n\`\`\`\n` +
            (result.timedOut ? '⏱️ Timeout' : `Code de sortie: ${result.exitCode}`);
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
    } else {
      vscode.window.showErrorMessage(`Jarvis: rollback échoué — ${result.error}`);
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

  constructor(private context: vscode.ExtensionContext) {
    this.sidebarProvider = new JarvisSidebarProvider(context);
  }

  public initialize(): void {
    console.log('JarvisExtension: initialisation');
    this.setupStatusBar();

    const registration = vscode.window.registerWebviewViewProvider(
      JarvisSidebarProvider.viewType,
      this.sidebarProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    );
    this.context.subscriptions.push(registration);
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
}
