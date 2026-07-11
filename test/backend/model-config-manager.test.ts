import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined }
}));

import { ModelConfigManager } from '../../src/backend/config/model-config-manager.js';
import type { ConfigManager, JarvisConfig, ModelItem } from '../../src/backend/config/config-manager.js';

function fakeConfigManager(items: ModelItem[], defaultModel: string | null = null): ConfigManager {
  const config: JarvisConfig = {
    version: 1,
    models: { default: defaultModel, items }
  };
  return {
    getConfig: () => config,
    getGlobalConfig: () => config,
    writeGlobal: vi.fn().mockResolvedValue(undefined)
  } as unknown as ConfigManager;
}

const chatModel: ModelItem = {
  name: 'GPT-OSS 120B',
  provider: 'openrouter',
  model: 'openai/gpt-oss-120b:free',
  apiKey: 'sk-or-x',
  roles: ['chat', 'edit', 'apply'],
  contextLength: 32768,
  maxTokens: 2048
};

const tabModel: ModelItem = {
  name: 'Qwen tab',
  provider: 'ollama',
  model: 'qwen2.5-coder:1.5b',
  roles: ['autocomplete'],
  contextLength: 8192
};

describe('ModelConfigManager (model-centric schema)', () => {
  it('instantiates one provider per enabled model, keyed by display name', () => {
    const mgr = new ModelConfigManager(fakeConfigManager([chatModel, tabModel]));
    expect(mgr.getProvider('GPT-OSS 120B')).toBeDefined();
    expect(mgr.getProvider('Qwen tab')).toBeDefined();
    expect(mgr.getProvider('unknown')).toBeUndefined();
  });

  it('skips disabled models', () => {
    const mgr = new ModelConfigManager(
      fakeConfigManager([{ ...chatModel, enabled: false }, tabModel])
    );
    expect(mgr.getProvider('GPT-OSS 120B')).toBeUndefined();
    expect(mgr.getAvailableModels().map(m => m.name)).toEqual(['Qwen tab']);
  });

  it('resolves the effective model: default first, else first enabled', () => {
    expect(new ModelConfigManager(fakeConfigManager([chatModel, tabModel], 'Qwen tab')).getEffectiveModel()).toBe('Qwen tab');
    expect(new ModelConfigManager(fakeConfigManager([chatModel, tabModel])).getEffectiveModel()).toBe('GPT-OSS 120B');
    expect(new ModelConfigManager(fakeConfigManager([])).getEffectiveModel()).toBeNull();
  });

  it('finds a model by role, falling back to the effective model for chat', () => {
    const mgr = new ModelConfigManager(fakeConfigManager([chatModel, tabModel]));
    expect(mgr.getModelForRole('autocomplete')?.name).toBe('Qwen tab');
    expect(mgr.getModelForRole('chat')?.name).toBe('GPT-OSS 120B');
    expect(mgr.getModelForRole('embed')).toBeNull();
  });

  it('falls back to the effective chat model for autocomplete when nothing is explicitly tagged', () => {
    const mgr = new ModelConfigManager(fakeConfigManager([chatModel]));
    expect(mgr.getModelForRole('autocomplete')?.name).toBe('GPT-OSS 120B');
  });

  it('returns the contextLength only when explicitly set in config, else null', () => {
    const mgr = new ModelConfigManager(fakeConfigManager([chatModel]));
    expect(mgr.getContextLength('GPT-OSS 120B')).toBe(32768);
    expect(mgr.getContextLength('unknown')).toBeNull();
    expect(mgr.getContextLength(null)).toBeNull();
    // Pas de contextLength en config, même pour une famille de modèle connue → null
    // (pas d'estimation affichée tant que l'utilisateur ne l'a pas réglée lui-même).
    const noCtx = new ModelConfigManager(
      fakeConfigManager([{ name: 'Codestral', provider: 'mistral', model: 'codestral-latest' }])
    );
    expect(noCtx.getContextLength('Codestral')).toBeNull();
  });

  it('classifies cloud vs local by model name or provider type', () => {
    const mgr = new ModelConfigManager(fakeConfigManager([chatModel, tabModel]));
    expect(mgr.isCloudProvider('GPT-OSS 120B')).toBe(true);
    expect(mgr.isCloudProvider('Qwen tab')).toBe(false);
    expect(mgr.isCloudProvider('openrouter')).toBe(true);
    expect(mgr.isCloudProvider('ollama')).toBe(false);
    expect(mgr.isCloudProvider('lmstudio')).toBe(false);
    // Inconnu => cloud par sécurité (le scrubbing s'applique).
    expect(mgr.isCloudProvider('mystery')).toBe(true);
  });

  it('reports the provider type of a model', () => {
    const mgr = new ModelConfigManager(fakeConfigManager([chatModel, tabModel]));
    expect(mgr.getProviderNameForModel('Qwen tab')).toBe('ollama');
    expect(mgr.getProviderNameForModel('GPT-OSS 120B')).toBe('openrouter');
    // Fallback : premier modèle activé.
    expect(mgr.getProviderNameForModel(null)).toBe('openrouter');
  });
});
