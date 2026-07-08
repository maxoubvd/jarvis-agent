import * as vscode from 'vscode';
import { ChangeTracker } from '../services/change-tracker.js';

export class JarvisCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly getChangeTracker: () => ChangeTracker) {}

  public refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const changeTracker = this.getChangeTracker();
    const filePath = document.uri.fsPath;

    // Vérifier si le fichier est en attente
    if (!changeTracker.isPending(filePath)) {
      return [];
    }

    const view = changeTracker.snapshot().find(
      v => vscode.Uri.file(v.path).fsPath === document.uri.fsPath
    );
    if (!view) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];

    // CodeLens en haut du fichier pour accepter/rejeter toutes les modifications du fichier
    const topRange = new vscode.Range(0, 0, 0, 0);
    lenses.push(
      new vscode.CodeLens(topRange, {
        title: '✓ Accept All Changes',
        command: 'jarvis.acceptFile',
        arguments: [filePath]
      }),
      new vscode.CodeLens(topRange, {
        title: '✗ Reject All Changes',
        command: 'jarvis.rejectFile',
        arguments: [filePath]
      })
    );

    // CodeLens pour chaque hunk de modifications
    for (const hunk of view.hunks) {
      // Les lignes dans vscode.Range sont 0-indexées.
      // `hunk.afterStart` est 1-indexé, donc la ligne dans le document est `hunk.afterStart - 1`.
      const line = Math.max(0, hunk.afterStart - 1);
      const range = new vscode.Range(line, 0, line, 0);

      lenses.push(
        new vscode.CodeLens(range, {
          title: '✓ Accept Hunk',
          command: 'jarvis.acceptHunk',
          arguments: [filePath, hunk.id, view.revision]
        }),
        new vscode.CodeLens(range, {
          title: '✗ Reject Hunk',
          command: 'jarvis.rejectHunk',
          arguments: [filePath, hunk.id, view.revision]
        })
      );
    }

    return lenses;
  }
}
