/**
 * `jarvis` — the CLI entry point.
 *
 *   jarvis                     home page + interactive REPL
 *   jarvis "<prompt>"          one-shot: run once, print, exit
 *   jarvis -p "<prompt>"       same, explicit
 *   jarvis settings            interactive settings navigator
 *   jarvis config              open ~/.jarvis/config.json in $EDITOR
 *   jarvis checkpoints         list Git checkpoints
 *   jarvis rollback            roll back to the last checkpoint
 *   jarvis init                analyze the project and write JARVIS.md
 *   jarvis analytics           export usage analytics
 *   jarvis --help | --version
 *
 * All real work lives in @jarvis/core; this file is just argument dispatch.
 */
import {
  AgentOrchestrator,
  type AgentEvents,
  type ProviderUsage
} from '@jarvis/core';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { JarvisCliHost } from './host.js';
import { renderHome, type HomeStatus } from './home.js';
import { startRepl } from './repl.js';
import { runSettings, openConfigInEditor } from './settings-nav.js';
import { accent, gold, green, dim, bold } from './theme.js';

const VERSION = '1.1.0';

marked.use(markedTerminal({ reflowText: true, width: Math.min(process.stdout.columns || 80, 100) }) as never);

function statusOf(host: JarvisCliHost): HomeStatus {
  const model = host.effectiveModel();
  return {
    model,
    provider: host.providerName(model),
    workspace: host.workspace,
    hitlMode: host.hitl.getMode(),
    needsSetup: !model
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const first = argv[0];

  // Flags handled before building a host.
  if (first === '--version' || first === '-v') {
    process.stdout.write(`jarvis ${VERSION}\n`);
    return;
  }
  if (first === '--help' || first === '-h') {
    printUsage();
    return;
  }

  const host = new JarvisCliHost();

  switch (first) {
    case 'settings':
      await runSettings();
      return;
    case 'config':
      await openConfigInEditor();
      return;
    case 'checkpoints': {
      const list = await host.checkpoints.listCheckpoints();
      if (!list.length) process.stdout.write(dim('No checkpoints yet.\n'));
      for (const c of list) process.stdout.write(`${gold('•')} ${bold(c.id)} ${dim(c.description ?? '')}\n`);
      return;
    }
    case 'rollback': {
      const r = await host.checkpoints.rollbackToLastCheckpoint();
      process.stdout.write((r.success ? green('✓ Rolled back.') : accent(`✗ ${r.error ?? 'failed'}`)) + '\n');
      return;
    }
    case 'analytics': {
      const { AnalyticsCollector } = await import('@jarvis/core');
      try {
        const path = await new AnalyticsCollector().export(p => {
          process.stdout.write(green(`✓ Exported to ${p}\n`));
        });
        if (!path) process.stdout.write(dim('Nothing to export.\n'));
      } catch (e) {
        process.stdout.write(accent(`Analytics error: ${e instanceof Error ? e.message : String(e)}\n`));
      }
      return;
    }
    case 'init':
      await runOnce(host, 'Analyze this project (structure, stack, conventions, scripts) and create a concise JARVIS.md at the workspace root documenting it for an AI agent.');
      return;
  }

  // One-shot prompt: `jarvis -p "…"` or `jarvis "…"`.
  if (first === '-p' || first === '--prompt') {
    const prompt = argv.slice(1).join(' ').trim();
    if (prompt) await runOnce(host, prompt);
    else process.stderr.write(accent('Missing prompt after -p.\n'));
    return;
  }
  if (first && !first.startsWith('-')) {
    await runOnce(host, argv.join(' ').trim());
    return;
  }

  // No arguments → home page + interactive REPL.
  process.stdout.write(renderHome(statusOf(host)));
  await startRepl(host);
}

/** Minimal one-shot agent run (no REPL): stream progress, print the final answer. */
async function runOnce(host: JarvisCliHost, prompt: string): Promise<void> {
  const active = host.activeModel();
  if (!active) {
    process.stderr.write(accent('No model configured. Run `jarvis settings` first.\n'));
    process.exitCode = 1;
    return;
  }
  const registry = await host.buildRegistry();
  const orchestrator = new AgentOrchestrator(active.provider, registry, {
    systemPrompt: host.buildSystemPrompt(registry),
    hitl: host.hitl,
    scrub: host.scrubFor(active.model),
    workspaceFolder: host.workspace,
    maxIterations: host.config().optimization?.agentMaxIterations ?? 100
  });

  let finalText = '';
  const events: AgentEvents = {
    onToolCall: (name, args) => process.stdout.write(`  ${gold('⚙')} ${gold(name)}${summarize(args)}\n`),
    onToolResult: (name, result, ok) => process.stdout.write(`    ${ok ? green('✓') : accent('✗')} ${dim(name)}\n`),
    onFinalChunk: c => {
      finalText += c;
    }
  };
  const result = await orchestrator.run(prompt, [], events);
  const answer = finalText || result.finalText || '(no answer)';
  process.stdout.write(`\n${bold(accent('◆ Jarvis'))}\n${String(marked.parse(answer)).replace(/\n+$/, '')}\n`);
  trackUsage(host, active.model, result.usage);
}

function trackUsage(host: JarvisCliHost, model: string, usage?: ProviderUsage): void {
  if (!usage) return;
  host.tokenCounter.addRequest(model, usage.promptTokens ?? 0, usage.completionTokens ?? 0, usage.cachedTokens ?? 0);
}

function summarize(args: Record<string, unknown>): string {
  const s = Object.entries(args)
    .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
    .join(', ');
  return s ? dim(` (${s})`) : '';
}

function printUsage(): void {
  process.stdout.write(
    [
      bold(gold('Jarvis CLI')) + dim(` v${VERSION}`),
      '',
      '  ' + bold('jarvis') + dim('                     home page + interactive chat'),
      '  ' + bold('jarvis "<prompt>"') + dim('          one-shot run'),
      '  ' + bold('jarvis -p "<prompt>"') + dim('       one-shot run (explicit)'),
      '  ' + bold('jarvis settings') + dim('            configure models, approvals, …'),
      '  ' + bold('jarvis config') + dim('              open ~/.jarvis/config.json in $EDITOR'),
      '  ' + bold('jarvis checkpoints') + dim('         list Git checkpoints'),
      '  ' + bold('jarvis rollback') + dim('            roll back to the last checkpoint'),
      '  ' + bold('jarvis init') + dim('                write a JARVIS.md for this project'),
      '  ' + bold('jarvis analytics') + dim('           export usage analytics'),
      '  ' + bold('jarvis --help | --version'),
      ''
    ].join('\n') + '\n'
  );
}

main().catch(err => {
  process.stderr.write(accent(`\nFatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`));
  process.exitCode = 1;
});
