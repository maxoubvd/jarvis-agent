import { IModelProvider } from '../models/abstract.js';
import { OllamaProvider } from '../models/providers/ollama.js';
import { OpenRouterProvider } from '../models/providers/openrouter.js';
import { LMStudioProvider } from '../models/providers/lmstudio.js';
import { MistralProvider } from '../models/providers/mistral.js';
import { OpenAICompatibleProvider } from '../models/providers/openai-compatible-provider.js';
import { defaultContextLength, effectiveTemperature } from '../services/model-profiles.js';
import {
  ConfigManager,
  getConfigManager,
  DEFAULT_BASE_URL,
  type JarvisConfig,
  type ModelItem,
  type ModelRole,
  type ProviderType
} from './config-manager.js';

// Réexport pour compat ascendante (consommateurs dans src/backend/models/*).
export type { JarvisConfig, ModelItem, ModelRole, ProviderType };

const LOCAL_PROVIDERS: ProviderType[] = ['ollama', 'lmstudio'];

function createProvider(item: ModelItem): IModelProvider {
  const baseUrl = item.apiBase ?? DEFAULT_BASE_URL[item.provider];
  const common = {
    baseUrl,
    apiKey: item.apiKey,
    model: item.model,
    maxTokens: item.maxTokens,
    // Réglage utilisateur > profil du modèle (devstral/codestral/qwen-coder) > défaut API.
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
      // 'openai' et 'openai-compatible' partagent le même protocole.
      return new OpenAICompatibleProvider({ name: item.provider, ...common });
  }
}

/**
 * Consommateur de {@link ConfigManager} : instancie un provider par modèle
 * activé (schéma centré modèle, façon Continue). Ne lit plus le disque et ne
 * throw plus — une config vide (aucun modèle) est un état valide (onboarding).
 */
export class ModelConfigManager {
  /** Un provider par modèle activé, indexé par `ModelItem.name`. */
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

  /** Provider instancié pour le modèle donné (clé = `ModelItem.name`). */
  public getProvider(modelName: string): IModelProvider | undefined {
    return this.providers.get(modelName);
  }

  /** Entrée de config du modèle donné (activé ou non). */
  public getModelItem(modelName: string | null): ModelItem | undefined {
    if (!modelName) return undefined;
    return this.config.models.items.find(m => m.name === modelName);
  }

  /** Modèle par défaut, ou `null` si aucun modèle n'est configuré. */
  public getDefaultModel(): string | null {
    return this.config.models.default;
  }

  /** Modèle effectif : défaut si valide (activé), sinon premier modèle activé, sinon `null`. */
  public getEffectiveModel(): string | null {
    const preferred = this.config.models.default;
    if (preferred && this.providers.has(preferred)) return preferred;
    return this.getAvailableModels()[0]?.name ?? null;
  }

  /** Modèles activés (le sélecteur du header + la jauge en dépendent). */
  public getAvailableModels(): ModelItem[] {
    return this.enabledItems();
  }

  /**
   * Premier modèle activé portant le rôle demandé. Pour `chat`, retombe sur le
   * modèle effectif (un modèle sans `roles` est considéré généraliste).
   */
  public getModelForRole(role: ModelRole): ModelItem | null {
    const explicit = this.enabledItems().find(m => m.roles?.includes(role));
    if (explicit) return explicit;
    if (role === 'chat') {
      const effective = this.getEffectiveModel();
      return effective ? this.getModelItem(effective) ?? null : null;
    }
    return null;
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

  /** Type de provider du modèle donné (défaut : premier modèle activé). */
  public getProviderNameForModel(modelName: string | null): ProviderType | undefined {
    const item = this.getModelItem(modelName) ?? this.enabledItems()[0];
    return item?.provider;
  }

  /**
   * Longueur de contexte du modèle : config > défaut de la famille de modèle
   * (voir `defaultContextLength`) > `null` si inconnue / aucun modèle.
   */
  public getContextLength(modelName: string | null): number | null {
    const item = this.getModelItem(modelName);
    return item?.contextLength ?? defaultContextLength(item) ?? null;
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
   * Accepte un type de provider ou un nom de modèle ; par sécurité, tout ce qui
   * n'est pas identifié local (ollama/lmstudio) est considéré cloud.
   */
  public isCloudProvider(providerOrModel: string): boolean {
    if (LOCAL_PROVIDERS.includes(providerOrModel as ProviderType)) return false;
    const item = this.getModelItem(providerOrModel);
    if (item) return !LOCAL_PROVIDERS.includes(item.provider);
    return true;
  }
}
