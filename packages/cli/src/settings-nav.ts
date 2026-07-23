/**
 * `jarvis settings` — an interactive navigator over ~/.jarvis/config.json, mirroring
 * the extension's SettingsPanel sections. The important, high-frequency knobs (models,
 * default model, approvals, chat behavior, web search, profile) are fully editable here;
 * the richer list editors (agents/workflows/prompts/rules/docs/MCP) open the JSON file
 * in $EDITOR, since the same config powers both the CLI and the extension.
 */
import { spawn } from 'child_process';
import { select, input, confirm, password } from '@inquirer/prompts';
import {
  getConfigManager,
  type JarvisConfig,
  type ModelItem,
  type ProviderType
} from '@jarvis/core';
import { accent, gold, dim, bold, green } from './theme.js';

async function save(mutate: (cfg: JarvisConfig) => void): Promise<void> {
  const cm = getConfigManager();
  const cfg = structuredClone(cm.getConfig());
  mutate(cfg);
  await cm.writeGlobal(cfg);
}

export async function runSettings(): Promise<void> {
  process.stdout.write('\n' + bold(gold('⚙  Jarvis Settings')) + dim('  — ~/.jarvis/config.json\n\n'));
  for (;;) {
    const section = await select({
      message: 'Settings',
      choices: [
        { name: 'Models', value: 'models', description: 'Providers, API keys, default model' },
        { name: 'Approvals (HITL)', value: 'hitl', description: 'strict / moderate / free' },
        { name: 'Chat behavior', value: 'chat', description: 'mode, thinking, iterations, autocomplete' },
        { name: 'Web search', value: 'web', description: 'provider + default sites' },
        { name: 'Profile', value: 'profile', description: 'your first name' },
        { name: 'Open config file in $EDITOR', value: 'edit', description: 'agents, workflows, rules, MCP…' },
        { name: 'Back', value: 'back' }
      ]
    }).catch(() => 'back');

    if (section === 'back') return;
    if (section === 'models') await modelsMenu();
    else if (section === 'hitl') await hitlMenu();
    else if (section === 'chat') await chatMenu();
    else if (section === 'web') await webMenu();
    else if (section === 'profile') await profileMenu();
    else if (section === 'edit') await openConfigInEditor();
  }
}

async function modelsMenu(): Promise<void> {
  for (;;) {
    const cfg = getConfigManager().getConfig();
    const items = cfg.models?.items ?? [];
    const def = cfg.models?.default ?? null;
    process.stdout.write('\n');
    if (items.length === 0) process.stdout.write(dim('  (no models yet)\n'));
    for (const m of items) {
      const mark = m.name === def ? green(' ★ default') : '';
      process.stdout.write(`  ${gold('•')} ${bold(m.name)} ${dim(`${m.provider} · ${m.model}`)}${mark}\n`);
    }
    const action = await select({
      message: 'Models',
      choices: [
        { name: 'Add a model', value: 'add' },
        { name: 'Set default model', value: 'default', disabled: items.length === 0 },
        { name: 'Remove a model', value: 'remove', disabled: items.length === 0 },
        { name: 'Back', value: 'back' }
      ]
    }).catch(() => 'back');
    if (action === 'back') return;

    if (action === 'add') {
      const provider = (await select<ProviderType>({
        message: 'Provider',
        choices: [
          { name: 'Ollama (local)', value: 'ollama' },
          { name: 'LM Studio (local)', value: 'lmstudio' },
          { name: 'OpenRouter', value: 'openrouter' },
          { name: 'Mistral', value: 'mistral' },
          { name: 'OpenAI-compatible (OpenAI, Anthropic, Gemini…)', value: 'openai-compatible' }
        ]
      })) as ProviderType;
      const name = await input({ message: 'Display name', default: provider });
      const model = await input({ message: 'Model id (e.g. qwen2.5-coder, gpt-4o)' });
      const isCloud = provider !== 'ollama' && provider !== 'lmstudio';
      const apiKey = isCloud ? await password({ message: 'API key (blank if none)', mask: '•' }) : '';
      const apiBase = await input({ message: 'API base URL (blank for provider default)', default: '' });
      await save(c => {
        c.models = c.models ?? { default: null, items: [] };
        c.models.items = c.models.items ?? [];
        const item: ModelItem = { name, provider, model, enabled: true };
        if (apiKey) item.apiKey = apiKey;
        if (apiBase) item.apiBase = apiBase;
        c.models.items.push(item);
        if (!c.models.default) c.models.default = name;
      });
      process.stdout.write(green(`  ✓ Added ${name}\n`));
    } else if (action === 'default') {
      const name = await select({
        message: 'Default model',
        choices: items.map(m => ({ name: m.name, value: m.name }))
      });
      await save(c => {
        c.models = c.models ?? { default: null, items: [] };
        c.models.default = name;
      });
      process.stdout.write(green(`  ✓ Default → ${name}\n`));
    } else if (action === 'remove') {
      const name = await select({
        message: 'Remove which model?',
        choices: items.map(m => ({ name: m.name, value: m.name }))
      });
      if (await confirm({ message: `Remove ${name}?`, default: false })) {
        await save(c => {
          if (!c.models) return;
          c.models.items = (c.models.items ?? []).filter(m => m.name !== name);
          if (c.models.default === name) c.models.default = c.models.items[0]?.name ?? null;
        });
        process.stdout.write(accent(`  ✓ Removed ${name}\n`));
      }
    }
  }
}

async function hitlMenu(): Promise<void> {
  const current = getConfigManager().getConfig().optimization?.hitlMode ?? 'moderate';
  const mode = await select({
    message: `Approval mode (current: ${current})`,
    choices: [
      { name: 'strict — confirm every action', value: 'strict' },
      { name: 'moderate — confirm dangerous actions only', value: 'moderate' },
      { name: 'free — never confirm (autonomous)', value: 'free' }
    ]
  }).catch(() => current);
  await save(c => {
    c.optimization = c.optimization ?? {};
    c.optimization.hitlMode = mode as 'strict' | 'moderate' | 'free';
  });
  process.stdout.write(green(`  ✓ Approvals → ${mode}\n`));
}

async function chatMenu(): Promise<void> {
  const opt = getConfigManager().getConfig().optimization ?? {};
  const chatMode = await select({
    message: `Chat mode (current: ${opt.chatMode ?? 'agent'})`,
    choices: [
      { name: 'agent — full agentic loop with tools', value: 'agent' },
      { name: 'chat — plain conversation, no tools', value: 'chat' }
    ]
  }).catch(() => opt.chatMode ?? 'agent');
  const showThinking = await confirm({ message: 'Show the model\'s thinking?', default: opt.showThinking ?? true });
  const iterations = await input({
    message: 'Max agent iterations',
    default: String(opt.agentMaxIterations ?? 100),
    validate: v => (/^\d+$/.test(v) ? true : 'number required')
  });
  await save(c => {
    c.optimization = c.optimization ?? {};
    c.optimization.chatMode = chatMode as 'agent' | 'chat';
    c.optimization.showThinking = showThinking;
    c.optimization.agentMaxIterations = Number(iterations);
  });
  process.stdout.write(green('  ✓ Chat behavior updated\n'));
}

async function webMenu(): Promise<void> {
  const ws = getConfigManager().getConfig().webSearch;
  const sites = await input({
    message: 'Default sites (comma-separated, blank for none)',
    default: (ws?.defaultSites ?? []).join(', ')
  });
  await save(c => {
    c.webSearch = {
      provider: 'duckduckgo',
      defaultSites: sites.split(',').map(s => s.trim()).filter(Boolean)
    };
  });
  process.stdout.write(green('  ✓ Web search updated\n'));
}

async function profileMenu(): Promise<void> {
  const cfg = getConfigManager().getConfig();
  const firstName = await input({ message: 'Your first name', default: cfg.firstName ?? '' });
  await save(c => {
    c.firstName = firstName || undefined;
  });
  process.stdout.write(green('  ✓ Profile updated\n'));
}

export async function openConfigInEditor(): Promise<void> {
  const filePath = getConfigManager().getGlobalConfigPath();
  const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'nano');
  process.stdout.write(dim(`  Opening ${filePath} in ${editor}…\n`));
  await new Promise<void>(resolve => {
    const child = spawn(editor, [filePath], { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', () => resolve());
    child.on('error', () => {
      process.stdout.write(accent(`  Could not launch ${editor}. Edit manually: ${filePath}\n`));
      resolve();
    });
  });
}
