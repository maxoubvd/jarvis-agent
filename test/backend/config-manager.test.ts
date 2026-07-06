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
  EMPTY_CONFIG,
  type JarvisConfig
} from '../../src/backend/config/config-manager.js';

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

  it('merges providers by key, replacing models[] but keeping untouched fields', () => {
    const base = {
      models: {
        default: 'a',
        providers: {
          ollama: { enabled: true, baseUrl: 'http://x', models: [{ name: 'a', contextLength: 1 }] }
        }
      }
    };
    const merged = deepMerge(base, {
      models: { providers: { ollama: { apiKey: 'k', models: [{ name: 'b', contextLength: 2 }] } } }
    });
    expect(merged.models.default).toBe('a');
    expect(merged.models.providers.ollama).toEqual({
      enabled: true,
      baseUrl: 'http://x',
      apiKey: 'k',
      models: [{ name: 'b', contextLength: 2 }]
    });
  });
});

describe('normalizeConfig', () => {
  it('fills in a complete shape from partial/garbage input', () => {
    expect(normalizeConfig(null)).toEqual(EMPTY_CONFIG);
    expect(normalizeConfig({ models: { default: 'x' } }).models.providers).toEqual({});
    expect(normalizeConfig({}).models.default).toBeNull();
  });
});

describe('ConfigManager', () => {
  it('creates an empty global config on first run when nothing exists', () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    expect(fs.existsSync(globalPath)).toBe(true);
    expect(cm.getConfig().models.default).toBeNull();
    expect(cm.getConfig().models.providers).toEqual({});
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
    expect(cm.getGlobalConfig().models.providers.ollama.models[0].name).toBe('qwen');
  });

  it('applies the workspace file as an override on top of global', () => {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(
      globalPath,
      JSON.stringify({
        version: 1,
        models: {
          default: 'global-model',
          providers: { openrouter: { enabled: true, baseUrl: 'https://g', apiKey: 'gk', models: [{ name: 'global-model', contextLength: 1000 }] } }
        }
      }),
      'utf-8'
    );
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    fs.writeFileSync(workspacePath, JSON.stringify({ models: { default: 'ws-model' } }), 'utf-8');

    const cm = new ConfigManager({ globalPath, workspacePath });
    // override wins on the scalar default...
    expect(cm.getConfig().models.default).toBe('ws-model');
    // ...but the global providers remain (deep merge)
    expect(cm.getConfig().models.providers.openrouter.apiKey).toBe('gk');
    // getGlobalConfig stays raw (unmerged)
    expect(cm.getGlobalConfig().models.default).toBe('global-model');
  });

  it('persists writeGlobal and re-computes the merged view', async () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    const next: JarvisConfig = {
      version: 1,
      models: { default: 'm', providers: { ollama: { enabled: true, baseUrl: 'http://x', models: [{ name: 'm', contextLength: 8000 }] } } },
      optimization: {}
    };
    await cm.writeGlobal(next);
    expect(cm.getConfig().models.default).toBe('m');
    const onDisk = JSON.parse(fs.readFileSync(globalPath, 'utf-8')) as JarvisConfig;
    expect(onDisk.models.providers.ollama.models[0].contextLength).toBe(8000);
  });

  it('notifies onDidChange listeners on write', async () => {
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    const listener = vi.fn();
    cm.onDidChange(listener);
    await cm.writeGlobal({ version: 1, models: { default: null, providers: {} } });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('falls back to empty config on malformed global JSON without throwing', () => {
    fs.mkdirSync(path.dirname(globalPath), { recursive: true });
    fs.writeFileSync(globalPath, '{ not json', 'utf-8');
    const cm = new ConfigManager({ globalPath, workspacePath: null });
    expect(cm.getConfig().models.providers).toEqual({});
  });
});
