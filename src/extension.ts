import * as vscode from 'vscode';
import { JarvisExtension } from './backend/core/extension.js';
import { backgroundProcesses } from './backend/services/background-processes.js';
import { getSandbox } from './backend/core/mcp/tools/fileSystem.js';
import { getConfigManager } from './backend/config/config-manager.js';
import { ModelConfigManager } from './backend/config/model-config-manager.js';
import { JarvisInlineCompletionProvider } from './backend/core/autocomplete/provider.js';

export function activate(context: vscode.ExtensionContext) {
  console.log('Jarvis: activation de l\'extension');
  const jarvis = new JarvisExtension(context);

  const commands = [
    vscode.commands.registerCommand('jarvis.startChat', () => jarvis.startChat()),
    vscode.commands.registerCommand('jarvis.rollback', () => jarvis.showRollbackPanel()),
    vscode.commands.registerCommand('jarvis.listCheckpoints', () => jarvis.listCheckpoints()),
    vscode.commands.registerCommand('jarvis.exportAnalytics', () => jarvis.exportAnalytics()),
    vscode.commands.registerCommand('jarvis.generateJarvisignore', () => jarvis.generateJarvisignore()),
    vscode.commands.registerCommand('jarvis.addToJarvisignore', (uri?: vscode.Uri) => jarvis.addToJarvisignore(uri)),
    vscode.commands.registerCommand('jarvis.removeFromJarvisignore', () => jarvis.removeFromJarvisignore()),
    vscode.commands.registerCommand('jarvis.indexWorkspace', () => jarvis.indexWorkspace()),
    vscode.commands.registerCommand('jarvis.inlineEdit', () => jarvis.inlineEdit()),
    vscode.commands.registerCommand('jarvis.init', () => jarvis.runInit())
  ];

  context.subscriptions.push(...commands);
  jarvis.initialize();

  // Autocomplete inline (Tab / ghost text) — désactivé par défaut (jarvis.autocomplete.enabled).
  const autocompleteModelConfig = new ModelConfigManager();
  const inlineCompletionProvider = new JarvisInlineCompletionProvider({
    isEnabled: () => {
      const cfg = getConfigManager().getConfig();
      return cfg.optimization?.autocompleteEnabled
        ?? vscode.workspace.getConfiguration('jarvis').get<boolean>('autocomplete.enabled', false);
    },
    getModel: () => {
      const item = autocompleteModelConfig.getModelForRole('autocomplete');
      return item ? autocompleteModelConfig.getProvider(item.name) ?? null : null;
    },
    isSandboxed: uri => {
      try {
        return getSandbox().canAccess(uri.fsPath).allowed;
      } catch {
        return false;
      }
    }
  });
  context.subscriptions.push(
    inlineCompletionProvider,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineCompletionProvider)
  );

  // Génère le fichier .jarvisignore automatiquement après que le workspace soit prêt.
  // Différé + protégé par try/catch : SandboxManager lève si aucun dossier n'est ouvert,
  // ce qui ferait échouer activate() (et donc toute l'extension) si appelé plus haut sans garde.
  setTimeout(async () => {
    try {
      const sandbox = getSandbox();
      await sandbox.ensureIgnoreFile();
    } catch (err) {
      console.warn('Jarvis: impossible de créer .jarvisignore:', err);
    }
  }, 1000);
}

export function deactivate() {
  console.log('Jarvis: désactivation de l\'extension');
  // Ne laisse aucun processus lancé via run_in_background survivre à l'extension.
  backgroundProcesses.dispose();
}
