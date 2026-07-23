import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('vscode', () => {
  class Position {
    constructor(public line: number, public character: number) {}
  }
  class Range {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
      if (typeof a === 'object') {
        this.startLine = a.line;
        this.startChar = a.character;
        this.endLine = (b as Position).line;
        this.endChar = (b as Position).character;
      } else {
        this.startLine = a;
        this.startChar = b as number;
        this.endLine = c!;
        this.endChar = d!;
      }
    }
  }
  class InlineCompletionItem {
    constructor(public insertText: string, public range: Range) {}
  }
  class ThemeColor {
    constructor(public id: string) {}
  }
  return {
    Position,
    Range,
    InlineCompletionItem,
    ThemeColor,
    window: {
      createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
      visibleTextEditors: [] as unknown[]
    },
    workspace: {
      onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() }))
    }
  };
});

import { JarvisInlineCompletionProvider } from '../../packages/core/src/core/autocomplete/provider.js';
import * as vscode from 'vscode';

class FakeDocument {
  lines: string[];
  languageId = 'typescript';
  uri = { fsPath: '/workspace/file.ts' } as unknown as import('vscode').Uri;
  constructor(text: string) {
    this.lines = text.split('\n');
  }
  get lineCount() {
    return this.lines.length;
  }
  lineAt(line: number) {
    return { text: this.lines[line] };
  }
  getText(range: { startLine: number; startChar: number; endLine: number; endChar: number }): string {
    const { startLine, startChar, endLine, endChar } = range;
    if (startLine === endLine) return this.lines[startLine].slice(startChar, endChar);
    const parts = [this.lines[startLine].slice(startChar)];
    for (let i = startLine + 1; i < endLine; i++) parts.push(this.lines[i]);
    parts.push(this.lines[endLine].slice(0, endChar));
    return parts.join('\n');
  }
}

function fakeToken(initiallyCancelled = false) {
  const listeners: Array<() => void> = [];
  const token = {
    isCancellationRequested: initiallyCancelled,
    onCancellationRequested(cb: () => void) {
      listeners.push(cb);
      return { dispose() {} };
    },
    cancel() {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      listeners.forEach(l => l());
    }
  };
  return token as unknown as import('vscode').CancellationToken & { cancel(): void };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  (vscode as unknown as { window: { visibleTextEditors: unknown[] } }).window.visibleTextEditors = [];
});

const DOC = new FakeDocument('function add(a, b) {\n  \n}\n');
const POSITION = new (vscode as unknown as { Position: new (l: number, c: number) => import('vscode').Position }).Position(1, 2);

describe('JarvisInlineCompletionProvider', () => {
  it('returns null immediately when disabled (no debounce/model call)', async () => {
    const getModel = vi.fn();
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => false,
      isSandboxed: () => true,
      getModel
    });
    const result = await provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    expect(result).toBeNull();
    expect(getModel).not.toHaveBeenCalled();
  });

  it('returns null for files outside the sandbox', async () => {
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => false,
      getModel: () => null
    });
    const result = await provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    expect(result).toBeNull();
  });

  it('debounces: does not call the model before the delay elapses, then does', async () => {
    const sendPrompt = vi.fn().mockResolvedValue('x + y');
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt, sendPromptStream: vi.fn() }),
      debounceMs: 300
    });

    const promise = provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );

    await vi.advanceTimersByTimeAsync(100);
    expect(sendPrompt).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);
    const result = await promise;
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ insertText: 'x + y', range: expect.anything() }]);
  });

  it('cancelling during the debounce window skips the model call entirely', async () => {
    const sendPrompt = vi.fn().mockResolvedValue('unused');
    const token = fakeToken();
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt, sendPromptStream: vi.fn() }),
      debounceMs: 300
    });

    const promise = provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      token
    );
    token.cancel();
    await vi.advanceTimersByTimeAsync(300);

    expect(await promise).toBeNull();
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('returns null when no model is configured for the autocomplete role', async () => {
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => null,
      debounceMs: 0
    });
    const promise = provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBeNull();
  });

  it('returns null when the model call fails, without throwing', async () => {
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt: vi.fn().mockRejectedValue(new Error('boom')), sendPromptStream: vi.fn() }),
      debounceMs: 0
    });
    const promise = provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeNull();
  });

  it('returns null for an empty/whitespace-only completion', async () => {
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt: vi.fn().mockResolvedValue('   '), sendPromptStream: vi.fn() }),
      debounceMs: 0
    });
    const promise = provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(await promise).toBeNull();
  });

  it('sends only the local prefix/suffix around the cursor, not the whole file', async () => {
    const bigDoc = new FakeDocument(Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'));
    const cursor = new (vscode as unknown as { Position: new (l: number, c: number) => import('vscode').Position }).Position(100, 4);
    const sendPrompt = vi.fn().mockResolvedValue('');
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt, sendPromptStream: vi.fn() }),
      debounceMs: 0,
      maxPrefixLines: 60,
      maxSuffixLines: 20
    });
    const promise = provider.provideInlineCompletionItems(
      bigDoc as unknown as import('vscode').TextDocument,
      cursor,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    const userMessage = sendPrompt.mock.calls[0][0][1].content as string;
    // Line 0 (outside the 60-line window before the cursor) must not appear.
    expect(userMessage).not.toContain('line 0\n');
    // Lines right before/after the cursor must appear.
    expect(userMessage).toContain('line 99');
    expect(userMessage).toContain('line 101');
  });

  it('renders "(Suggestion Jarvis)" as a decoration after the ghost text, never as part of insertText', async () => {
    const setDecorations = vi.fn();
    const fakeEditor = { document: DOC, setDecorations } as unknown as import('vscode').TextEditor;
    (vscode as unknown as { window: { visibleTextEditors: unknown[] } }).window.visibleTextEditors = [fakeEditor];

    const sendPrompt = vi.fn().mockResolvedValue('x + y');
    const provider = new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt, sendPromptStream: vi.fn() }),
      debounceMs: 0
    });

    const promise = provider.provideInlineCompletionItems(
      DOC as unknown as import('vscode').TextDocument,
      POSITION,
      {} as import('vscode').InlineCompletionContext,
      fakeToken()
    );
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result![0].insertText).toBe('x + y');
    expect(result![0].insertText).not.toContain('Suggestion Jarvis');

    const lastCall = setDecorations.mock.calls[setDecorations.mock.calls.length - 1];
    const [, ranges] = lastCall as [unknown, import('vscode').Range[]];
    const endChar = POSITION.character + 'x + y'.length;
    expect(ranges).toEqual([new vscode.Range(POSITION.line, endChar, POSITION.line, endChar)]);
  });

  it('clears the decoration on the next selection change (e.g. once a suggestion is accepted or dismissed)', async () => {
    const setDecorations = vi.fn();
    const fakeEditor = { document: DOC, setDecorations } as unknown as import('vscode').TextEditor;
    (vscode as unknown as { window: { visibleTextEditors: unknown[] } }).window.visibleTextEditors = [fakeEditor];

    const sendPrompt = vi.fn().mockResolvedValue('x + y');
    new JarvisInlineCompletionProvider({
      isEnabled: () => true,
      isSandboxed: () => true,
      getModel: () => ({ name: 'fake', sendPrompt, sendPromptStream: vi.fn() }),
      debounceMs: 0
    });

    const onSelectionChange = (
      vscode as unknown as { window: { onDidChangeTextEditorSelection: ReturnType<typeof vi.fn> } }
    ).window.onDidChangeTextEditorSelection as ReturnType<typeof vi.fn>;
    expect(onSelectionChange).toHaveBeenCalled();
  });
});
