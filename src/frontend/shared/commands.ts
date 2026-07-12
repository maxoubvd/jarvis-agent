/**
 * Shared registry of `/` commands and `@` mentions offered by chat
 * autocompletion. Mirrors the backend routing (extension.ts).
 */

export type TriggerChar = '/' | '@';

export interface CommandItem {
  trigger: TriggerChar;
  /** Text inserted on acceptance (with trailing space/`:` if relevant). */
  insert: string;
  /** Displayed label. */
  label: string;
  /** Short description shown to the right. */
  detail: string;
  /** Moves the caret back N characters from the end of `insert` (e.g. to position between quotes). */
  caretBack?: number;
}

export const SLASH_COMMANDS: CommandItem[] = [
  { trigger: '/', insert: '/new ', label: '/new', detail: 'New conversation' },
  { trigger: '/', insert: '/resume ', label: '/resume', detail: 'Resume a past conversation' },
  { trigger: '/', insert: '/agent ', label: '/agent', detail: 'Agentic mode on a task' },
  { trigger: '/', insert: '/tdd ', label: '/tdd', detail: 'Auto-TDD loop' },
  { trigger: '/', insert: '/workflow ', label: '/workflow', detail: 'Run a predefined workflow' },
  { trigger: '/', insert: '/rollback', label: '/rollback', detail: 'Undo changes since the last message' },
  { trigger: '/', insert: '/init', label: '/init', detail: 'Initialize project (git init + generate JARVIS.md)' }
];

export const AT_MENTIONS: CommandItem[] = [
  { trigger: '@', insert: '@file:', label: '@file:', detail: 'Add a file to context' },
  { trigger: '@', insert: '@docs:', label: '@docs:', detail: 'Search the indexed docs' },
  { trigger: '@', insert: '@read ', label: '@read', detail: 'Read a file (no model)' },
  { trigger: '@', insert: '@list ', label: '@list', detail: 'List a directory (no model)' },
  { trigger: '@', insert: '@write ', label: '@write', detail: 'Write a file (no model)' },
  { trigger: '@', insert: '@run ', label: '@run', detail: 'Run a terminal command (no model)' },
  { trigger: '@', insert: '@QA-Agent ', label: '@QA-Agent', detail: 'Quality agent' },
  { trigger: '@', insert: '@Doc-Agent ', label: '@Doc-Agent', detail: 'Documentation agent' },
  { trigger: '@', insert: '@Refactor-Agent ', label: '@Refactor-Agent', detail: 'Refactoring agent' },
  { trigger: '@', insert: '@Security-Agent ', label: '@Security-Agent', detail: 'Security agent' },
  { trigger: '@', insert: '@Perf-Agent ', label: '@Perf-Agent', detail: 'Performance agent' }
];

export interface TriggerMatch {
  trigger: TriggerChar;
  /** Index of the trigger character in the text. */
  tokenStart: number;
  /** Text typed after the trigger, up to the caret. */
  partial: string;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

/**
 * Detects whether the caret sits inside a token triggered by `/` or `@`.
 * - `/` is only active at the very start of the input (command).
 * - `@` is active at the start of the input or after a space.
 * Returns `null` if the current token contains a space (token finished).
 */
export function matchTrigger(text: string, caret: number): TriggerMatch | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '/' || ch === '@') {
      const atStart = i === 0;
      const afterSpace = i > 0 && isWhitespace(text[i - 1]);
      if (ch === '/' && !atStart) return null;
      if (ch === '@' && !(atStart || afterSpace)) return null;
      return { trigger: ch, tokenStart: i, partial: text.slice(i + 1, caret) };
    }
    if (isWhitespace(ch)) return null;
    i--;
  }
  return null;
}

/**
 * Registry items matching the current token (case-insensitive prefix).
 * `extra` allows injecting dynamic items (agents/workflows
 * sent by the backend via the `capabilities` message).
 */
export function filterCommands(match: TriggerMatch, extra: CommandItem[] = []): CommandItem[] {
  const statics = match.trigger === '/' ? SLASH_COMMANDS : AT_MENTIONS;
  const dynamics = extra.filter(c => c.trigger === match.trigger);
  // Dynamic items replace any matching static item (same insert).
  const seen = new Set(dynamics.map(c => c.insert));
  const pool = [...dynamics, ...statics.filter(c => !seen.has(c.insert))];
  const query = (match.trigger + match.partial).toLowerCase();
  return pool.filter(
    c => c.insert.toLowerCase().startsWith(query) || c.label.toLowerCase().startsWith(query)
  );
}
