import * as vscode from 'vscode';

export class JarvisExtension {
  constructor(private context: vscode.ExtensionContext) {}

  public initialize(): void {
    console.log('JarvisExtension: initialisation');
  }

  public startChat(): void {
    vscode.window.showInformationMessage('Jarvis: démarrage du chat');
  }

  public showRollbackPanel(): void {
    vscode.window.showInformationMessage('Jarvis: afficher le rollback');
  }

  public listCheckpoints(): void {
    vscode.window.showInformationMessage('Jarvis: lister les checkpoints');
  }
}
