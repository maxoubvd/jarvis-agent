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

    // Check whether the file is pending review
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

    // CodeLens at the top of the file to accept/reject all changes in the file
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

    // CodeLens for each change hunk
    for (const hunk of view.hunks) {
      // Lines in vscode.Range are 0-indexed.
      // `hunk.afterStart` is 1-indexed, so the line in the document is `hunk.afterStart - 1`.
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
