import { IModelProvider } from '../models/abstract.js';
import { OllamaProvider } from '../models/providers/ollama.js';
import { OpenRouterProvider } from '../models/providers/openrouter.js';
import { LMStudioProvider } from '../models/providers/lmstudio.js';
import { MistralProvider } from '../models/providers/mistral.js';
import { OpenAICompatibleProvider } from '../models/providers/openai-compatible-provider.js';
import {
  ConfigManager,
  getConfigManager,
  ProviderType,
  type JarvisConfig,
  type ModelConfigItem,
  type ProviderConfigItem
} from './config-manager.js';

// Réexport pour compat ascendante (consommateurs dans src/backend/models/*).
export type { JarvisConfig, ModelConfigItem, ProviderConfigItem };

function inferType(providerName: string): ProviderType {
  switch (providerName) {
    case 'ollama':
    case 'openrouter':
    case 'lmstudio':
    case 'mistral':
      return providerName;
    default:
      return 'openai-compatible';
  }
}

/**
 * Consommateur de {@link ConfigManager} : instancie les providers activés à
 * partir de la config effective. Ne lit plus le disque et ne throw plus —
 * une config vide (aucun modèle) est un état valide (onboarding).
 */
export class ModelConfigManager {
  private providers: Map<string, IModelProvider> = new Map();

  constructor(private cfg: ConfigManager = getConfigManager()) {
    this.initializeProviders();
  }

  private get config(): JarvisConfig {
    return this.cfg.getConfig();
  }

  private initializeProviders(): void {
    this.providers.clear();
    const providersConfig = this.config.models.providers;
    const defaultModel = this.config.models.default;

    for (const [providerName, providerConfig] of Object.entries(providersConfig)) {
      if (!providerConfig.enabled) continue;

      const providerModelNames = providerConfig.models.map(m => m.name);
      const model =
        defaultModel && providerModelNames.includes(defaultModel)
          ? defaultModel
          : providerModelNames[0];
      if (!model) continue; // provider activé mais sans modèle

      const type = providerConfig.type ?? inferType(providerName);
      switch (type) {
        case 'ollama':
          this.providers.set(providerName, new OllamaProvider({ baseUrl: providerConfig.baseUrl, model }));
          break;
        case 'openrouter':
          this.providers.set(
            providerName,
            new OpenRouterProvider({ baseUrl: providerConfig.baseUrl, apiKey: providerConfig.apiKey, model })
          );
          break;
        case 'lmstudio':
          this.providers.set(providerName, new LMStudioProvider({ baseUrl: providerConfig.baseUrl, model }));
          break;
        case 'mistral':
          this.providers.set(
            providerName,
            new MistralProvider({ baseUrl: providerConfig.baseUrl, apiKey: providerConfig.apiKey, model })
          );
          break;
        default:
          this.providers.set(
            providerName,
            new OpenAICompatibleProvider({
              name: providerName,
              baseUrl: providerConfig.baseUrl,
              apiKey: providerConfig.apiKey,
              model
            })
          );
          break;
      }
    }
  }

  public getProvider(providerName: string): IModelProvider | undefined {
    return this.providers.get(providerName);
  }

  /** Modèle par défaut, ou `null` si aucun modèle n'est configuré. */
  public getDefaultModel(): string | null {
    return this.config.models.default;
  }

  /** Modèle effectif : défaut si valide, sinon premier modèle disponible, sinon `null`. */
  public getEffectiveModel(): string | null {
    const preferred = this.config.models.default;
    if (preferred) return preferred;
    return this.getAvailableModels()[0]?.name ?? null;
  }

  public getAvailableModels(): ModelConfigItem[] {
    const allModels: ModelConfigItem[] = [];
    for (const providerConfig of Object.values(this.config.models.providers)) {
      if (providerConfig.enabled) {
        allModels.push(...providerConfig.models);
      }
    }
    return allModels;
  }

  public async reloadConfig(): Promise<void> {
    await this.cfg.reload();
    this.initializeProviders();
  }

  /** Ré-instancie les providers depuis la config courante (après un changement externe). */
  public refresh(): void {
    this.initializeProviders();
  }

  public getConfig(): JarvisConfig {
    return this.config;
  }

  /** Premier provider activé qui propose le modèle demandé (défaut sinon). */
  public getProviderNameForModel(modelName: string | null): string | undefined {
    if (modelName) {
      for (const [name, providerConfig] of Object.entries(this.config.models.providers)) {
        if (providerConfig.enabled && providerConfig.models.some(m => m.name === modelName)) {
          return name;
        }
      }
    }
    return Object.keys(this.config.models.providers).find(k => this.config.models.providers[k].enabled);
  }

  public getContextLength(modelName: string | null): number {
    if (modelName) {
      for (const providerConfig of Object.values(this.config.models.providers)) {
        const found = providerConfig.models.find(m => m.name === modelName);
        if (found) return found.contextLength;
      }
    }
    return 32768;
  }

  /** Change le modèle par défaut (persisté dans la config globale) et ré-instancie. */
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
   * True si le provider envoie les données hors de la machine (spec §6.1).
   * Par sécurité, tout provider non-local (≠ ollama/lmstudio) est considéré cloud.
   */
  public isCloudProvider(providerName: string): boolean {
    const providerConfig = this.config.models.providers[providerName];
    const type = providerConfig?.type ?? inferType(providerName);
    return type !== 'ollama' && type !== 'lmstudio';
  }
}
