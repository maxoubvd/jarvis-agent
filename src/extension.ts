import * as vscode from 'vscode';
import { JarvisExtension } from './backend/core/extension.js';

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
    vscode.commands.registerCommand('jarvis.indexWorkspace', () => jarvis.indexWorkspace())
  ];

  context.subscriptions.push(...commands);
  jarvis.initialize();
}

export function deactivate() {
  console.log('Jarvis: désactivation de l\'extension');
}
