import { IModelProvider } from '../models/abstract.js';
import { OllamaProvider } from '../models/providers/ollama.js';
import { OpenRouterProvider } from '../models/providers/openrouter.js';
import { LMStudioProvider } from '../models/providers/lmstudio.js';
import { MistralProvider } from '../models/providers/mistral.js';
import { OpenAICompatibleProvider } from '../models/providers/openai-compatible-provider.js';
import { effectiveTemperature } from '../services/model-profiles.js';
import {
  ConfigManager,
  getConfigManager,
  DEFAULT_BASE_URL,
  type JarvisConfig,
  type ModelItem,
  type ModelRole,
  type ProviderType
} from './config-manager.js';

// Re-exported for backward compatibility (consumers in src/backend/models/*).
export type { JarvisConfig, ModelItem, ModelRole, ProviderType };

const LOCAL_PROVIDERS: ProviderType[] = ['ollama', 'lmstudio'];

/** Instantiates a standalone provider from a model config (onboarding connection test). */
export function createProviderFromItem(item: ModelItem): IModelProvider {
  return createProvider(item);
}

function createProvider(item: ModelItem): IModelProvider {
  const baseUrl = item.apiBase ?? DEFAULT_BASE_URL[item.provider];
  const common = {
    baseUrl,
    apiKey: item.apiKey,
    model: item.model,
    maxTokens: item.maxTokens,
    // User setting > model profile (devstral/codestral/qwen-coder) > API default.
    temperature: effectiveTemperature(item)
  };
  switch (item.provider) {
    case 'ollama':
      return new OllamaProvider(common);
    case 'openrouter':
      return new OpenRouterProvider(common);
    case 'lmstudio':
      return new LMStudioProvider(common);
    case 'mistral':
      return new MistralProvider(common);
    default:
      // 'openai' and 'openai-compatible' share the same protocol.
      return new OpenAICompatibleProvider({ name: item.provider, ...common });
  }
}

/**
 * Consumer of {@link ConfigManager}: instantiates one provider per enabled model
 * (model-centric schema, Continue-style). No longer reads from disk and no longer
 * throws — an empty config (no models) is a valid state (onboarding).
 */
export class ModelConfigManager {
  /** One provider per enabled model, indexed by `ModelItem.name`. */
  private providers: Map<string, IModelProvider> = new Map();

  constructor(private cfg: ConfigManager = getConfigManager()) {
    this.initializeProviders();
  }

  private get config(): JarvisConfig {
    return this.cfg.getConfig();
  }

  private enabledItems(): ModelItem[] {
    return this.config.models.items.filter(m => m.enabled !== false);
  }

  private initializeProviders(): void {
    this.providers.clear();
    for (const item of this.enabledItems()) {
      this.providers.set(item.name, createProvider(item));
    }
  }

  /** Provider instantiated for the given model (key = `ModelItem.name`). */
  public getProvider(modelName: string): IModelProvider | undefined {
    return this.providers.get(modelName);
  }

  /** Config entry for the given model (enabled or not). */
  public getModelItem(modelName: string | null): ModelItem | undefined {
    if (!modelName) return undefined;
    return this.config.models.items.find(m => m.name === modelName);
  }

  /** Default model, or `null` if no model is configured. */
  public getDefaultModel(): string | null {
    return this.config.models.default;
  }

  /** Effective model: the default if valid (enabled), otherwise the first enabled model, otherwise `null`. */
  public getEffectiveModel(): string | null {
    const preferred = this.config.models.default;
    if (preferred && this.providers.has(preferred)) return preferred;
    return this.getAvailableModels()[0]?.name ?? null;
  }

  /** Enabled models (the header selector + the gauge depend on this). */
  public getAvailableModels(): ModelItem[] {
    return this.enabledItems();
  }

  /**
   * First enabled model carrying the requested role. For `chat`/`autocomplete`, falls back to
   * the effective model (a model without `roles` is considered general-purpose; autocomplete
   * needs a default model even if none has been explicitly tagged `autocomplete`).
   */
  public getModelForRole(role: ModelRole): ModelItem | null {
    const explicit = this.enabledItems().find(m => m.roles?.includes(role));
    if (explicit) return explicit;
    if (role === 'chat' || role === 'autocomplete') {
      const effective = this.getEffectiveModel();
      return effective ? this.getModelItem(effective) ?? null : null;
    }
    return null;
  }

  public async reloadConfig(): Promise<void> {
    await this.cfg.reload();
    this.initializeProviders();
  }

  /** Re-instantiates the providers from the current config (after an external change). */
  public refresh(): void {
    this.initializeProviders();
  }

  public getConfig(): JarvisConfig {
    return this.config;
  }

  /** Provider type for the given model (default: first enabled model). */
  public getProviderNameForModel(modelName: string | null): ProviderType | undefined {
    const item = this.getModelItem(modelName) ?? this.enabledItems()[0];
    return item?.provider;
  }

  /**
   * Context length of the model: only the value explicitly set in the config
   * (Settings > Models). `null` if absent — the context gauge stays hidden
   * rather than displaying an estimate not guaranteed by the user.
   */
  public getContextLength(modelName: string | null): number | null {
    return this.getModelItem(modelName)?.contextLength ?? null;
  }

  /** Changes the default model (persisted in the global config) and re-instantiates. */
  public async setDefaultModel(modelName: string): Promise<void> {
    const next = this.cfg.getGlobalConfig();
    const updated: JarvisConfig = {
      ...next,
      models: { ...next.models, default: modelName }
    };
    await this.cfg.writeGlobal(updated);
    this.initializeProviders();
  }

  /**
   * True if the provider sends data outside the machine (spec §6.1).
   * Accepts a provider type or a model name; for safety, anything not
   * identified as local (ollama/lmstudio) is considered cloud.
   */
  public isCloudProvider(providerOrModel: string): boolean {
    if (LOCAL_PROVIDERS.includes(providerOrModel as ProviderType)) return false;
    const item = this.getModelItem(providerOrModel);
    if (item) return !LOCAL_PROVIDERS.includes(item.provider);
    return true;
  }
}
