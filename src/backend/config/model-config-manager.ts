import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { IModelProvider } from '../models/abstract.js';
import { OllamaProvider } from '../models/providers/ollama.js';
import { OpenRouterProvider } from '../models/providers/openrouter.js';
import { LMStudioProvider } from '../models/providers/lmstudio.js';

export interface ModelConfigItem {
  name: string;
  contextLength: number;
}

export interface ProviderConfigItem {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  models: ModelConfigItem[];
}

export interface JarvisConfig {
  models: {
    default: string;
    providers: Record<string, ProviderConfigItem>;
  };
}

export class ModelConfigManager {
  private config: JarvisConfig;
  private configPath: string;
  private providers: Map<string, IModelProvider>;

  constructor() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error('Workspace introuvable');
    }
    
    this.configPath = path.join(workspaceFolder, 'jarvis', 'jarvis-config.json');
    this.providers = new Map();
    this.config = this.loadConfigSync();
    this.initializeProviders();
  }

  private loadConfigSync(): JarvisConfig {
    try {
      const configContent = fsSync.readFileSync(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      console.error('Erreur de chargement de la configuration:', error);
      throw new Error('Impossible de charger la configuration Jarvis');
    }
  }

  private async loadConfig(): Promise<JarvisConfig> {
    try {
      const configContent = await fs.readFile(this.configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      console.error('Erreur de chargement de la configuration:', error);
      throw new Error('Impossible de charger la configuration Jarvis');
    }
  }

  private initializeProviders(): void {
    const providersConfig = this.config.models.providers;
    const defaultModel = this.config.models.default;

    for (const [providerName, providerConfig] of Object.entries(providersConfig)) {
      if (!providerConfig.enabled) continue;

      // Prefer the global default model if this provider offers it,
      // otherwise fall back to the provider's first configured model.
      const providerModelNames = providerConfig.models.map(m => m.name);
      const model = providerModelNames.includes(defaultModel)
        ? defaultModel
        : providerModelNames[0];

      switch (providerName) {
        case 'ollama':
          this.providers.set(providerName, new OllamaProvider({
            baseUrl: providerConfig.baseUrl,
            model
          }));
          break;
        case 'openrouter':
          this.providers.set(providerName, new OpenRouterProvider({
            baseUrl: providerConfig.baseUrl,
            apiKey: providerConfig.apiKey,
            model
          }));
          break;
        case 'lmstudio':
          this.providers.set(providerName, new LMStudioProvider({
            baseUrl: providerConfig.baseUrl,
            model
          }));
          break;
      }
    }
  }

  public getProvider(providerName: string): IModelProvider | undefined {
    return this.providers.get(providerName);
  }

  public getDefaultModel(): string {
    return this.config.models.default;
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
    this.config = await this.loadConfig();
    this.providers.clear();
    this.initializeProviders();
  }

  public getConfig(): JarvisConfig {
    return this.config;
  }
}