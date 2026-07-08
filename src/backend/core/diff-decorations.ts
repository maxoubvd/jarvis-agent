import * as vscode from 'vscode';
import type { ChangeTracker } from '../services/change-tracker.js';

/**
 * Colore directement dans l'éditeur les modifications IA en attente de revue
 * (façon Cursor / Antigravity) : fond vert sur les lignes ajoutées, et rappel
 * rouge en « ghost text » des lignes supprimées (qui n'existent plus dans le
 * fichier déjà écrit sur disque). Se rafraîchit via {@link refresh} sur les
 * évolutions du ChangeTracker et les changements d'éditeur actif.
 */
export class DiffDecorationProvider {
  private readonly added: vscode.TextEditorDecorationType;
  private readonly removed: vscode.TextEditorDecorationType;

  constructor(private readonly getChangeTracker: () => ChangeTracker) {
    this.added = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
    this.removed = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left
    });
  }

  public dispose(): void {
    this.added.dispose();
    this.removed.dispose();
  }

  /** Ré-applique les décorations sur tous les éditeurs visibles. */
  public refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) this.apply(editor);
  }

  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.added, []);
    editor.setDecorations(this.removed, []);
  }

  private apply(editor: vscode.TextEditor): void {
    const tracker = this.getChangeTracker();
    const filePath = editor.document.uri.fsPath;
    if (!tracker.isPending(filePath)) {
      this.clear(editor);
      return;
    }
    const view = tracker.snapshot().find(v => vscode.Uri.file(v.path).fsPath === filePath);
    if (!view) {
      this.clear(editor);
      return;
    }

    const lineCount = editor.document.lineCount;
    const addedRanges: vscode.Range[] = [];
    const removedDecos: vscode.DecorationOptions[] = [];

    for (const hunk of view.hunks) {
      // Lignes ajoutées : présentes dans le document (contenu « après »).
      // `afterStart` est 1-indexé → première ligne 0-indexée = afterStart - 1.
      const start = Math.max(0, hunk.afterStart - 1);
      for (let i = 0; i < hunk.afterLines.length; i++) {
        const line = start + i;
        if (line < lineCount) addedRanges.push(new vscode.Range(line, 0, line, 0));
      }

      // Lignes supprimées : absentes du document → rappel en rouge (ghost text)
      // ancré sur la ligne du hunk.
      if (hunk.beforeLines.length > 0) {
        const anchor = Math.min(start, Math.max(0, lineCount - 1));
        const text = hunk.beforeLines.map(l => `− ${l}`).join('    ');
        removedDecos.push({
          range: new vscode.Range(anchor, 0, anchor, 0),
          renderOptions: {
            after: {
              contentText: `   ${text}`,
              color: new vscode.ThemeColor('editorError.foreground'),
              fontStyle: 'italic'
            }
          }
        });
      }
    }

    editor.setDecorations(this.added, addedRanges);
    editor.setDecorations(this.removed, removedDecos);
  }
}
