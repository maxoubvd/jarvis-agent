import * as vscode from 'vscode';
import type { IModelProvider } from '../../models/abstract.js';
import { buildCompletionPrompt, extractCompletionText } from './prompt.js';

export interface JarvisInlineCompletionProviderOptions {
  getModel: () => IModelProvider | null;
  isEnabled: () => boolean;
  isSandboxed: (uri: vscode.Uri) => boolean;
  /** Idle delay before triggering a request (default 350ms). */
  debounceMs?: number;
  /** Lines of context before/after the cursor sent to the model (default 60/20). */
  maxPrefixLines?: number;
  maxSuffixLines?: number;
}

/** Visual label shown right after the ghost text — never inserted (rendered via decoration, not insertText). */
const SUGGESTION_LABEL = '  (Suggestion Jarvis)';

/**
 * Provides ghost text (Tab) Continue.dev-style: a single non-agentic call
 * (`IModelProvider.sendPrompt`, not `AgentOrchestrator`) to stay fast, with
 * debounce + cancellation via `CancellationToken` on every new keystroke.
 */
export class JarvisInlineCompletionProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly subscriptions: vscode.Disposable[];
  private decoratedEditor: vscode.TextEditor | null = null;

  constructor(private options: JarvisInlineCompletionProviderOptions) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        contentText: SUGGESTION_LABEL,
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        fontStyle: 'italic'
      }
    });
    // No "ghost text shown/hidden" event exists on the VS Code side: we remove
    // the label as soon as the cursor/document/editor moves, and (re)apply it
    // only once a new suggestion is actually rendered.
    this.subscriptions = [
      vscode.window.onDidChangeTextEditorSelection(() => this.clearDecoration()),
      vscode.window.onDidChangeActiveTextEditor(() => this.clearDecoration()),
      vscode.workspace.onDidChangeTextDocument(() => this.clearDecoration())
    ];
  }

  public dispose(): void {
    this.decorationType.dispose();
    this.subscriptions.forEach(d => d.dispose());
  }

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | null> {
    this.clearDecoration();

    if (!this.options.isEnabled()) return null;
    if (!this.options.isSandboxed(document.uri)) return null;

    const cancelledEarly = await debounce(this.options.debounceMs ?? 350, token);
    if (cancelledEarly || token.isCancellationRequested) return null;

    const model = this.options.getModel();
    if (!model) return null;

    const prefix = textBefore(document, position, this.options.maxPrefixLines ?? 60);
    const suffix = textAfter(document, position, this.options.maxSuffixLines ?? 20);
    const messages = buildCompletionPrompt(prefix, suffix, document.languageId);

    let raw: string;
    try {
      const res = await model.sendPrompt(messages, undefined, tokenToAbortSignal(token));
      raw = typeof res === 'string' ? res : res.text;
    } catch {
      return null;
    }

    if (token.isCancellationRequested) return null;

    const text = extractCompletionText(raw);
    if (!text) return null;

    this.showDecoration(document, position, text);

    return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
  }

  private showDecoration(document: vscode.TextDocument, position: vscode.Position, text: string): void {
    const editor = vscode.window.visibleTextEditors.find(e => e.document === document);
    if (!editor) return;

    const lines = text.split('\n');
    const endPosition = lines.length === 1
      ? new vscode.Position(position.line, position.character + lines[0].length)
      : new vscode.Position(position.line + lines.length - 1, lines[lines.length - 1].length);

    editor.setDecorations(this.decorationType, [new vscode.Range(endPosition, endPosition)]);
    this.decoratedEditor = editor;
  }

  private clearDecoration(): void {
    if (this.decoratedEditor) {
      this.decoratedEditor.setDecorations(this.decorationType, []);
      this.decoratedEditor = null;
    }
  }
}

/** Resolves `true` (cancelled) as soon as `token.onCancellationRequested` fires, otherwise `false` after `ms`. */
function debounce(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve(true);
    });
  });
}

function tokenToAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

function textBefore(document: vscode.TextDocument, position: vscode.Position, maxLines: number): string {
  const startLine = Math.max(0, position.line - maxLines);
  return document.getText(new vscode.Range(startLine, 0, position.line, position.character));
}

function textAfter(document: vscode.TextDocument, position: vscode.Position, maxLines: number): string {
  const endLine = Math.min(document.lineCount - 1, position.line + maxLines);
  const endChar = document.lineAt(endLine).text.length;
  return document.getText(new vscode.Range(position.line, position.character, endLine, endChar));
}
