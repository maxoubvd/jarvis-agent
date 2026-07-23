import * as vscode from 'vscode';
import { JarvisExtension, JarvisInlineCompletionProvider } from '@jarvis/core/vscode';
import {
  backgroundProcesses,
  getSandbox,
  getConfigManager,
  ModelConfigManager,
  setActiveFileProvider
} from '@jarvis/core';

export function activate(context: vscode.ExtensionContext) {
  console.log('Jarvis: activating extension');

  // The shared core is vscode-free and resolves "the current project" from
  // JARVIS_WORKSPACE (falling back to process.cwd()). Seed it from the active
  // VS Code workspace folder before anything in core reads config or the sandbox.
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceFolder) {
    process.env.JARVIS_WORKSPACE = workspaceFolder;
  }

  // "read_currently_open_file" is a host concept: back it with the active editor.
  setActiveFileProvider(() => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    return {
      path: vscode.workspace.asRelativePath(editor.document.uri, false),
      content: editor.document.getText()
    };
  });

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

  // Inline autocomplete (Tab / ghost text) — disabled by default (jarvis.autocomplete.enabled).
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

  // Automatically generates .jarvisignore after the workspace is ready.
  // Deferred + protected by try/catch: SandboxManager throws if no folder is opened,
  // which would cause activate() (and thus the entire extension) to fail if called earlier without guard.
  setTimeout(async () => {
    try {
      const sandbox = getSandbox();
      await sandbox.ensureIgnoreFile();
    } catch (err) {
      console.warn('Jarvis: unable to create .jarvisignore:', err);
    }
  }, 1000);
}

export function deactivate() {
  console.log('Jarvis: deactivating extension');
  // Do not let any process started via run_in_background survive the extension.
  backgroundProcesses.dispose();
}
