/**
 * The Jarvis CLI interactive controller — the terminal counterpart of the extension's
 * onChatMessage routing. It owns the conversation state and slash-command dispatch, but
 * delegates every heavy operation (agent loop, TDD, workflows, checkpoints, mentions) to
 * the shared @jarvis/core engine. Streaming agent events are rendered to the terminal;
 * the final answer is formatted with marked-terminal, echoing the webview's marked render.
 */
import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { input, select, confirm } from '@inquirer/prompts';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import {
  AgentOrchestrator,
  buildAgentSystemPrompt,
  WorkflowRunner,
  getWorkflows,
  AutoTDDLoop,
  getAgents,
  detectAgentMention,
  expandMentions,
  executeTerminalCommand,
  type AgentEvents,
  type ChatMessage,
  type TodoItem,
  type ProviderUsage
} from '@jarvis/core';
import { JarvisCliHost } from './host.js';
import { accent, gold, green, dim, bold, glyph } from './theme.js';

marked.use(markedTerminal({ reflowText: true, width: Math.min(process.stdout.columns || 80, 100) }) as never);

function renderMarkdown(md: string): string {
  try {
    return String(marked.parse(md)).replace(/\n+$/, '');
  } catch {
    return md;
  }
}

type Mode = 'automatic' | 'fast' | 'plan';

export async function startRepl(host: JarvisCliHost): Promise<void> {
  let mode: Mode = host.config().optimization?.chatMode === 'chat' ? 'fast' : 'automatic';
  let history: ChatMessage[] = [];

  const promptLine = (): string => `${glyph.jarvis()} ${gold('▸')} ${dim(`[${mode}]`)}`;

  for (;;) {
    let line: string;
    try {
      line = await input({ message: promptLine() });
    } catch {
      // Ctrl-C / Ctrl-D
      process.stdout.write(dim('\nBye.\n'));
      return;
    }
    const text = line.trim();
    if (!text) continue;

    if (text.startsWith('/')) {
      const exit = await handleCommand(text);
      if (exit) return;
      continue;
    }

    await runTurn(text);
  }

  // ---- turn handling -------------------------------------------------------

  async function runTurn(rawInput: string, opts: { forceAgent?: boolean } = {}): Promise<void> {
    const active = host.activeModel();
    if (!active) {
      process.stdout.write(accent('  No model configured. Run ') + gold('/settings') + accent(' first.\n'));
      return;
    }

    // @file:/@docs: mentions → injected context.
    const { expanded } = await expandMentions(rawInput, {
      readFile: p => readFile(resolve(host.workspace, p), 'utf-8')
    });

    // @QA-Agent / @Doc-Agent / … persona detection.
    const mention = detectAgentMention(expanded, getAgents(host.config()));
    const persona = mention?.agent.systemPrompt;
    const task = mention ? expanded.split(mention.agent.mention).join('').trim() : expanded;

    const useFast = mode === 'fast' && !opts.forceAgent && !mention;
    if (useFast) {
      await streamChat(active.provider, task, history);
      return;
    }

    const registry = await host.buildRegistry();
    if (mention?.agent.allowedToolPrefixes) registry.restrictTo(mention.agent.allowedToolPrefixes);
    const planOnly = mode === 'plan';
    const systemPrompt = host.buildSystemPrompt(registry, persona, planOnly);
    const abort = new AbortController();

    const orchestrator = new AgentOrchestrator(active.provider, registry, {
      systemPrompt,
      hitl: host.hitl,
      scrub: host.scrubFor(active.model),
      workspaceFolder: host.workspace,
      abortSignal: abort.signal,
      maxIterations: host.config().optimization?.agentMaxIterations ?? 100
    });

    let finalText = '';
    const showThinking = host.config().optimization?.showThinking ?? true;
    const events: AgentEvents = {
      onThinking: t => {
        if (showThinking && t.trim()) process.stdout.write(dim(`  ${glyph.think()} ${oneLine(t)}\n`));
      },
      onToolCall: (name, args) => {
        process.stdout.write(`  ${glyph.tool()} ${gold(name)}${dim(argSummary(args))}\n`);
      },
      onToolResult: (_name, result, success) => {
        const icon = success ? green('✓') : accent('✗');
        process.stdout.write(`    ${icon} ${dim(oneLine(result, 100))}\n`);
      },
      onFinalChunk: chunk => {
        finalText += chunk;
      },
      onTodoUpdate: items => printTodos(items)
    };

    process.stdout.write(dim(`  ${persona ? mention?.agent.label + ' ' : ''}working…\n`));
    const result = await orchestrator.run(task, history.slice(-10), events).catch(err => {
      process.stdout.write(accent(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
      return null;
    });
    if (!result) return;

    const answer = finalText || result.finalText || '(no answer)';
    process.stdout.write(`\n${bold(accent('◆ Jarvis'))}\n${renderMarkdown(answer)}\n\n`);

    history.push({ role: 'user', content: rawInput });
    history.push({ role: 'assistant', content: answer });
    trackUsage(active.model, result.usage);
  }

  async function streamChat(
    provider: { sendPromptStream?: unknown; sendPrompt: (m: ChatMessage[]) => Promise<unknown> },
    task: string,
    hist: ChatMessage[]
  ): Promise<void> {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'You are Jarvis, a concise, helpful coding assistant.' },
      ...hist.slice(-10),
      { role: 'user', content: task }
    ];
    process.stdout.write(`\n${bold(accent('◆ Jarvis'))}\n`);
    let acc = '';
    await new Promise<void>(res => {
      const p = provider as unknown as {
        sendPromptStream?: (
          m: ChatMessage[],
          onChunk: (c: string) => void,
          onDone: (u?: ProviderUsage) => void,
          onError: (e: Error) => void
        ) => void;
      };
      if (p.sendPromptStream) {
        p.sendPromptStream(
          messages,
          c => {
            acc += c;
            process.stdout.write(c);
          },
          () => res(),
          e => {
            process.stdout.write(accent(`\n  Error: ${e.message}\n`));
            res();
          }
        );
      } else {
        provider.sendPrompt(messages).then(r => {
          acc = typeof r === 'string' ? r : (r as { text: string }).text;
          process.stdout.write(acc);
          res();
        });
      }
    });
    process.stdout.write('\n\n');
    hist.push({ role: 'user', content: task });
    hist.push({ role: 'assistant', content: acc });
  }

  // ---- slash commands ------------------------------------------------------

  async function handleCommand(text: string): Promise<boolean> {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ').trim();
    switch (cmd) {
      case 'exit':
      case 'quit':
        process.stdout.write(dim('Bye.\n'));
        return true;
      case 'help':
        printHelp();
        return false;
      case 'new':
      case 'clear':
        history = [];
        process.stdout.write(green('  ✓ New conversation.\n'));
        return false;
      case 'mode': {
        if (arg === 'automatic' || arg === 'fast' || arg === 'plan') mode = arg;
        else process.stdout.write(dim(`  Usage: /mode automatic|fast|plan (current: ${mode})\n`));
        if (arg) process.stdout.write(green(`  ✓ Mode → ${mode}\n`));
        return false;
      }
      case 'model': {
        const names = host.availableModelNames();
        if (arg && names.includes(arg)) {
          host.setDefaultModel(arg);
          process.stdout.write(green(`  ✓ Model → ${arg}\n`));
        } else if (names.length) {
          const chosen = await select({ message: 'Default model', choices: names.map(n => ({ name: n, value: n })) }).catch(() => null);
          if (chosen) {
            host.setDefaultModel(chosen);
            process.stdout.write(green(`  ✓ Model → ${chosen}\n`));
          }
        } else {
          process.stdout.write(dim('  No models. Use /settings.\n'));
        }
        return false;
      }
      case 'settings': {
        const { runSettings } = await import('./settings-nav.js');
        await runSettings();
        host.reloadModels();
        return false;
      }
      case 'checkpoints':
        await checkpointsFlow();
        return false;
      case 'rollback': {
        const r = await host.checkpoints.rollbackToLastCheckpoint();
        process.stdout.write((r.success ? green('  ✓ Rolled back.') : accent(`  ✗ ${r.error ?? 'failed'}`)) + '\n');
        return false;
      }
      case 'agent':
        if (arg) await runTurn(arg, { forceAgent: true });
        else process.stdout.write(dim('  Usage: /agent <task>\n'));
        return false;
      case 'tdd':
        if (arg) await runTdd(arg);
        else process.stdout.write(dim('  Usage: /tdd <task>\n'));
        return false;
      case 'workflow':
        await runWorkflow(rest);
        return false;
      case 'init':
        await runTurn(
          'Analyze this project (structure, stack, conventions, scripts) and create a concise JARVIS.md at the workspace root documenting it for an AI agent.',
          { forceAgent: true }
        );
        return false;
      default:
        process.stdout.write(dim(`  Unknown command: /${cmd}. Try /help.\n`));
        return false;
    }
  }

  async function checkpointsFlow(): Promise<void> {
    const list = await host.checkpoints.listCheckpoints();
    if (!list.length) {
      process.stdout.write(dim('  No checkpoints yet.\n'));
      return;
    }
    for (const c of list) process.stdout.write(`  ${gold('•')} ${bold(c.id)} ${dim(c.description ?? '')}\n`);
    const choice = await select({
      message: 'Rollback to a checkpoint?',
      choices: [{ name: 'Cancel', value: '' }, ...list.map(c => ({ name: `${c.id} — ${c.description ?? ''}`, value: c.id }))]
    }).catch(() => '');
    if (!choice) return;
    if (await confirm({ message: `Rollback to ${choice}? This discards later changes.`, default: false })) {
      const r = await host.checkpoints.restoreToCheckpoint(choice);
      process.stdout.write((r.success ? green('  ✓ Rolled back.') : accent(`  ✗ ${r.error ?? 'failed'}`)) + '\n');
    }
  }

  async function runTdd(task: string): Promise<void> {
    const active = host.activeModel();
    if (!active) return;
    const loop = new AutoTDDLoop(active.provider, {
      writeFile: async (p, content) => writeFile(resolve(host.workspace, p), content, 'utf-8'),
      runCommand: async (command, timeout) => {
        const r = await executeTerminalCommand(command, { timeout });
        return { success: r.success, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut };
      }
    });
    const opt = host.config().optimization ?? {};
    process.stdout.write(dim('  Auto-TDD loop…\n'));
    const result = await loop.run(
      task,
      { maxAttempts: opt.tddMaxAttempts, testCommand: opt.tddTestCommand },
      {
        onAttemptStart: (a, max) => process.stdout.write(`  ${gold('•')} attempt ${a}/${max}\n`),
        onTestResult: r => process.stdout.write(dim(`    tests: ${r.success ? 'pass' : 'fail'}\n`))
      }
    );
    process.stdout.write(
      (result.success ? green('  ✓ TDD passed') : accent('  ✗ TDD failed')) +
        dim(` (${result.attempts} attempts, ${result.filesWritten.length} files)\n`)
    );
  }

  async function runWorkflow(rest: string[]): Promise<void> {
    const [id, ...taskParts] = rest;
    const task = taskParts.join(' ').trim();
    const workflows = getWorkflows(host.config());
    if (!id || !task) {
      process.stdout.write(dim(`  Usage: /workflow <id> <task>. Available: ${workflows.map(w => w.id).join(', ')}\n`));
      return;
    }
    const active = host.activeModel();
    if (!active) return;
    const registry = await host.buildRegistry();
    const orchestrator = new AgentOrchestrator(active.provider, registry, {
      systemPrompt: buildAgentSystemPrompt(registry),
      hitl: host.hitl,
      scrub: host.scrubFor(active.model),
      workspaceFolder: host.workspace
    });
    const runner = new WorkflowRunner(orchestrator, async () => {
      await host.checkpoints.createCheckpoint('workflow', `Before workflow ${id}`);
    }, workflows);
    const result = await runner.run(id, task, {
      onStepStart: (name, i, total) => process.stdout.write(`  ${gold('▸')} step ${i + 1}/${total}: ${bold(name)}\n`)
    });
    process.stdout.write((result.success ? green('  ✓ ') : accent('  ✗ ')) + dim(result.summary || result.error || '') + '\n');
  }

  // ---- rendering helpers ---------------------------------------------------

  function trackUsage(model: string, usage?: ProviderUsage): void {
    if (!usage) return;
    host.tokenCounter.addRequest(model, usage.promptTokens ?? 0, usage.completionTokens ?? 0, usage.cachedTokens ?? 0);
    const u = host.tokenCounter.getUsage();
    process.stdout.write(dim(`  ${glyph.bullet()} tokens: ${u.used}${u.limit ? ` / ${u.limit}` : ''}\n\n`));
  }

  function printTodos(items: TodoItem[]): void {
    if (!items.length) return;
    process.stdout.write(dim('  ── todo ──\n'));
    for (const it of items) {
      const box = it.status === 'completed' ? green('[x]') : it.status === 'in_progress' ? gold('[~]') : dim('[ ]');
      process.stdout.write(`  ${box} ${it.content}\n`);
    }
  }
}

function oneLine(s: string, max = 120): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length > max ? line.slice(0, max) + '…' : line;
}

function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .map(([k, v]) => `${k}=${oneLine(String(v), 40)}`)
    .join(', ');
  return parts ? ` (${parts})` : '';
}

function printHelp(): void {
  const rows: [string, string][] = [
    ['<text>', 'send a message (agent in automatic/plan, chat in fast)'],
    ['/agent <task>', 'force the full agentic loop'],
    ['/tdd <task>', 'Auto-TDD: write code until tests pass'],
    ['/workflow <id> <task>', 'run a predefined workflow'],
    ['/init', 'analyze the project and write JARVIS.md'],
    ['/mode automatic|fast|plan', 'switch chat mode'],
    ['/model [name]', 'show or set the default model'],
    ['/settings', 'open the settings navigator'],
    ['/checkpoints', 'list Git checkpoints and roll back'],
    ['/rollback', 'roll back to the last checkpoint'],
    ['/new', 'start a fresh conversation'],
    ['@file:<path> @docs:<query>', 'inject file / documentation context'],
    ['@QA-Agent @Doc-Agent …', 'run a specialized agent'],
    ['/help  /exit', 'this help / quit']
  ];
  process.stdout.write('\n' + bold(gold('Jarvis CLI — commands')) + '\n');
  for (const [c, d] of rows) process.stdout.write(`  ${gold(c.padEnd(28))} ${dim(d)}\n`);
  process.stdout.write('\n');
}
