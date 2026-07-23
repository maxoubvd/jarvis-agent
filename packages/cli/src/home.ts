/**
 * The Jarvis CLI home page — shown when you run `jarvis` with no arguments,
 * before the interactive REPL starts. Red wordmark + gold subtitle + a status
 * line and command hints, echoing the extension's sidebar header.
 */
import { accent, gold, goldHover, dim, bold, green, glyph } from './theme.js';

const WORDMARK = [
  '      ██  █████  ██████  ██    ██ ██ ███████',
  '      ██ ██   ██ ██   ██ ██    ██ ██ ██     ',
  '      ██ ███████ ██████  ██    ██ ██ ███████',
  ' ██   ██ ██   ██ ██   ██  ██  ██  ██      ██',
  '  █████  ██   ██ ██   ██   ████   ██ ███████'
];

export interface HomeStatus {
  model: string | null;
  provider: string | null;
  workspace: string;
  hitlMode: string;
  needsSetup: boolean;
}

export function renderHome(status: HomeStatus): string {
  const lines: string[] = [''];
  for (const row of WORDMARK) lines.push('  ' + accent(row));
  lines.push('');
  lines.push('  ' + gold('Your autonomous software engineer — now in your terminal.'));
  lines.push('');

  const dot = status.needsSetup ? accent('●') : green('●');
  const modelLabel = status.model
    ? `${bold(status.model)}${status.provider ? dim(` (${status.provider})`) : ''}`
    : accent('no model configured');
  lines.push(`  ${dot} ${modelLabel}`);
  lines.push(`  ${glyph.bullet()} ${dim('workspace')}  ${status.workspace}`);
  lines.push(`  ${glyph.bullet()} ${dim('approvals')}  ${goldHover(status.hitlMode)} ${dim('(HITL)')}`);
  lines.push('');

  if (status.needsSetup) {
    lines.push('  ' + accent('⚠ No model yet.') + dim(' Run ') + gold('jarvis settings') + dim(' to add one.'));
    lines.push('');
  }

  lines.push(dim('  ─────────────────────────────────────────────────────────'));
  lines.push(`  ${dim('Type your request, or a command:')}`);
  lines.push(
    `    ${gold('/agent')} ${dim('<task>')}   ${gold('/tdd')} ${dim('<task>')}   ${gold('/workflow')} ${dim('<id> <task>')}`
  );
  lines.push(
    `    ${gold('/mode')} ${dim('automatic|fast|plan')}   ${gold('/settings')}   ${gold('/checkpoints')}`
  );
  lines.push(
    `    ${dim('mentions:')} ${gold('@file:')}${dim('path')}  ${gold('@docs:')}${dim('query')}  ${gold('@QA-Agent')} ${dim('…')}`
  );
  lines.push(`    ${gold('/help')} ${dim('for everything')}   ${gold('/exit')} ${dim('to quit')}`);
  lines.push('');
  return lines.join('\n');
}
