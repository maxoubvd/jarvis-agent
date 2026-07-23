import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// config-manager importe 'vscode' au niveau module → mock minimal.
vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined }
}));

import {
  ConfigManager,
  deepMerge,
  normalizeConfig,
  normalizeModelsSection,
  EMPTY_CONFIG,
  type JarvisConfig
} from '../../packages/core/src/config/config-manager.js';

let tmpDir: string;
let globalPath: string;
let workspacePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cfg-'));
  globalPath = path.join(tmpDir, 'global', 'config.json');
  workspacePath = path.join(tmpDir, 'ws', 'jarvis-config.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('deepMerge', () => {
  it('deep-merges plain objects, override wins on scalars', () => {
    const base = { a: 1, nested: { x: 1, y: 2 } };
    const merged = deepMerge(base, { a: 9, nested: { y: 5 } });
    expect(merged).toEqual({ a: 9, nested: { x: 1, y: 5 } });
  });

  it('replaces arrays wholesale instead of merging them', () => {
    const merged = deepMerge({ list: [1, 2, 3] }, { list: [9] });
    expect(merged).toEqual({ list: [9] });
  });

  it('keeps base value when override is undefined', () => {
    const base = { a: 1 };
    expect(deepMerge(base, undefined)).toBe(base);
  });

  it('merges the models section by key, replacing items[] wholesale', () => {
    const base = {
      models: {
        default: 'a',
        items: [{ name: 'a', provider: 'ollama', model: 'a' }]
      }
    };
    const merged = deepMerge(base, {
      models: { items: [{ name: 'b', provider: 'mistral', model: 'b' }] }
    });
    expect(merged.models.default).toBe('a');
    expect(merged.models.items).toEqual([{ name: 'b', provider: 'mistral', model: 'b' }]);
  });
});

describe('normalizeModelsSection (migration)', () => {
  it('migrates the legacy provider-centric shape to model items', () => {
    const models = normalizeModelsSection({
      default: 'qwen',
      providers: {
        ollama: {
          enabled: true,
          baseUrl: 'http://localhost:11434',
          models: [{ name: 'qwen', contextLength: 32768 }]
        },
        openrouter: {
          enabled: false,
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: 'sk-or-x',
          models: [{ name: 'gpt-oss', contextLength: 128000 }]
        }
      }
    });
    expect(models.default).toBe('qwen');
    expect(models.items).toHaveLength(2);
    const qwen = models.items.find(m => m.name === 'qwen');
    expect(qwen).toMatchObject({
      provider: 'ollama',
      model: 'qwen',
      apiBase: 'http://localhost:11434',
      contextLength: 32768,
      roles: ['chat', 'edit', 'apply']
    });
    const oss = models.items.find(m => m.name === 'gpt-oss');
    expect(oss).toMatchObject({ provider: 'openrouter', apiKey: 'sk-or-x', enabled: false });
  });

  it('is idempotent: an already-migrated section is coerced, never re-migrated', () => {
    const section = {
      default: 'GPT',
      items: [
        {
          name: 'GPT',
          provider: 'openrouter',
          model: 'openai/gpt-oss-120b:free',
          apiKey: 'k',
          roles: ['chat', 'autocomplete'],
          contextLength: 32768,
          maxTokens: 2048
        }
      ]
    };
    const first = normalizeModelsSection(section);
    const second = normalizeModelsSection(first);
    expect(second).toEqual(first);
    expect(second.items[0].roles).toEqual(['chat', 'autocomplete']);
    expect(second.items[0].maxTokens).toBe(2048);
  });

  it('drops malformed items and unknown roles/providers', () => {
    const models = normalizeModelsSection({
      items: [
        { name: '', provider: 'ollama', model: 'x' },
        { name: 'ok', provider: 'not-a-provider', roles: ['chat', 'pilot'] },
        'garbage'
      ]
    });
    expect(models.items).toHaveLength(1);
    expect(models.items[0]).toMatchObject({ name: 'ok', provider: 'openai-compatible', model: 'ok' });
    expect(models.items[0].roles).toEqual(['chat']);
  });

  it('disambiguates duplicate model names across legacy providers', () => {
    const models = normalizeModelsSection({
      providers: {
        ollama: { enabled: true, baseUrl: 'http://x', models: [{ name: 'm', contextLength: 1 }] },
        lmstudio: { enabled: true, baseUrl: 'http://y', models: [{ name: 'm', contextLength: 2 }] }
      }
    });
    expect(models.items.map(i => i.name)).toEqual(['m', 'm (lmstudio)']);
    // Les deux gardent l'id API d'origine.
    expect(models.items.map(i => i.model)).toEqual(['m', 'm']);
  });
});

describe('normalizeConfig', () => {
  it('fills in a complete shape from partial/garbage input', () => {
    expect(normalizeConfig(null)).toEqual(EMPTY_CONFIG);
    expect(normalizeConfig({ models: { default: 'x' } }).models.items).toEqual([]);
    expect(normalizeConfig({}).models.default).toBeNull();
  });

  // Anti-strip safeguard: normalizeConfig removes unknown keys, so
  // every new config field MUST pass through it, otherwise it is
  // silently deleted on first Settings save.
  it('round-trips builtinMcp, prompts, docs, workspaces, activeWorkspaceId and showThinking', () => {
    const input = {
      builtinMcp: { memory: { enabled: false }, fetch: { enabled: true, disabledTools: ['fetch'] } },
      mcpServers: {
        custom: { enabled: true, transport: 'stdio', command: 'npx', disabledTools: ['echo'] }
      },
      prompts: [{ id: 'p1', name: 'review', description: 'Revue', content: 'Fais une revue' }],
      docs: [{ id: 'd1', title: 'Svelte', startUrl: 'https://svelte.dev/docs', enabled: true }],
      workspaces: [
        { id: 'w1', name: 'API', folder: 'C:\\dev\\api', instructions: 'Stack: Node', enabled: true }
      ],
      activeWorkspaceId: 'w1',
      optimization: { hitlMode: 'strict', showThinking: false }
    };
    const normalized = normalizeConfig(input);
    expect(normalized.builtinMcp).toEqual(input.builtinMcp);
    expect(normalized.mcpServers).toEqual(input.mcpServers);
    expect(normalized.prompts).toEqual(input.prompts);
    expect(normalized.docs).toEqual(input.docs);
    expect(normalized.workspaces).toEqual(input.workspaces);
    expect(normalized.activeWorkspaceId).toBe('w1');
    expect(normalized.optimization).toEqual(input.optimization);
  });

  it('persists the new fields through writeGlobal (regression)', async () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    await cm.writeGlobal({
      version: 1,
      models: { default: null, items: [] },
      prompts: [{ id: 'p1', name: 'review', content: 'Fais une revue' }],
      docs: [{ id: 'd1', title: 'T', startUrl: 'https://x', enabled: true }],
      workspaces: [{ id: 'w1', name: 'W', folder: '', instructions: '', enabled: true }],
      activeWorkspaceId: 'w1',
      builtinMcp: { fetch: { enabled: true, disabledTools: ['fetch'] } }
    });
    const onDisk = JSON.parse(fs.readFileSync(globalPath, 'utf-8')) as JarvisConfig;
    expect(onDisk.prompts).toHaveLength(1);
    expect(onDisk.docs).toHaveLength(1);
    expect(onDisk.workspaces).toHaveLength(1);
    expect(onDisk.activeWorkspaceId).toBe('w1');
    expect(onDisk.builtinMcp).toEqual({ fetch: { enabled: true, disabledTools: ['fetch'] } });
  });
});

describe('ConfigManager', () => {
  it('creates an empty global config on first run when nothing exists', () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    expect(fs.existsSync(globalPath)).toBe(true);
    expect(cm.getConfig().models.default).toBeNull();
    expect(cm.getConfig().models.items).toEqual([]);
  });

  it('migrates (seeds) the global config from a legacy workspace file', () => {
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    const legacy = {
      models: {
        default: 'qwen',
        providers: { ollama: { enabled: true, baseUrl: 'http://localhost:11434', models: [{ name: 'qwen', contextLength: 32768 }] } }
      }
    };
    fs.writeFileSync(workspacePath, JSON.stringify(legacy), 'utf-8');

    const cm = new ConfigManager({ globalPath, workspacePath });
    const seededGlobal = JSON.parse(fs.readFileSync(globalPath, 'utf-8')) as JarvisConfig;
    expect(seededGlobal.models.default).toBe('qwen');
    expect(cm.getGlobalConfig().models.items[0]).toMatchObject({ name: 'qwen', provider: 'ollama' });
  });

  it('migrates a legacy-shaped global file on load', () => {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(
      globalPath,
      JSON.stringify({
        version: 1,
        models: {
          default: 'codestral-latest',
          providers: {
            mistral: { enabled: true, baseUrl: 'https://api.mistral.ai/v1', apiKey: 'mk', models: [{ name: 'codestral-latest', contextLength: 32768 }] }
          }
        }
      }),
      'utf-8'
    );
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    expect(cm.getGlobalConfig().models.items[0]).toMatchObject({
      name: 'codestral-latest',
      provider: 'mistral',
      apiKey: 'mk',
      contextLength: 32768
    });
  });

  it('applies the workspace file as an override on top of global', () => {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(
      globalPath,
      JSON.stringify({
        version: 1,
        models: {
          default: 'global-model',
          items: [{ name: 'global-model', provider: 'openrouter', model: 'gm', apiKey: 'gk', contextLength: 1000 }]
        }
      }),
      'utf-8'
    );
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    fs.writeFileSync(workspacePath, JSON.stringify({ models: { default: 'ws-model' } }), 'utf-8');

    const cm = new ConfigManager({ globalPath, workspacePath });
    // override wins on the scalar default...
    expect(cm.getConfig().models.default).toBe('ws-model');
    // ...but the global items remain (deep merge, items absent from override)
    expect(cm.getConfig().models.items[0].apiKey).toBe('gk');
    // getGlobalConfig stays raw (unmerged)
    expect(cm.getGlobalConfig().models.default).toBe('global-model');
  });

  it('migrates a legacy-shaped workspace override before merging', () => {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(
      globalPath,
      JSON.stringify({ version: 1, models: { default: null, items: [] } }),
      'utf-8'
    );
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    fs.writeFileSync(
      workspacePath,
      JSON.stringify({
        models: {
          providers: { ollama: { enabled: true, baseUrl: 'http://x', models: [{ name: 'ws-m', contextLength: 4096 }] } }
        }
      }),
      'utf-8'
    );
    const cm = new ConfigManager({ globalPath, workspacePath });
    expect(cm.getConfig().models.items[0]).toMatchObject({ name: 'ws-m', provider: 'ollama' });
    // The global default is not overwritten by a ghost `null` from migration.
    expect(cm.getConfig().models.default).toBeNull();
  });

  it('persists writeGlobal and re-computes the merged view', async () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    const next: JarvisConfig = {
      version: 1,
      models: { default: 'm', items: [{ name: 'm', provider: 'ollama', model: 'm', contextLength: 8000 }] },
      optimization: {}
    };
    await cm.writeGlobal(next);
    expect(cm.getConfig().models.default).toBe('m');
    const onDisk = JSON.parse(fs.readFileSync(globalPath, 'utf-8')) as JarvisConfig;
    expect(onDisk.models.items[0].contextLength).toBe(8000);
  });

  it('notifies onDidChange listeners on write', async () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    const listener = vi.fn();
    cm.onDidChange(listener);
    await cm.writeGlobal({ version: 1, models: { default: null, items: [] } });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('falls back to empty config on malformed global JSON without throwing', () => {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, '{ not json', 'utf-8');
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    expect(cm.getConfig().models.items).toEqual([]);
  });
});
