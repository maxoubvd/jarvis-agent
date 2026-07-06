import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Workflow } from '../services/workflows.js';
import type { SpecializedAgent } from '../services/agents.js';

export type ProviderType = 'ollama' | 'openrouter' | 'lmstudio' | 'mistral' | 'openai-compatible';

export interface ModelConfigItem {
  name: string;
  contextLength: number;
}

export interface ProviderConfigItem {
  enabled: boolean;
  /** Type de provider — déduit de la clé si absent (clé inconnue => 'openai-compatible'). */
  type?: ProviderType;
  baseUrl: string;
  apiKey?: string;
  models: ModelConfigItem[];
}

export interface McpServerConfig {
  enabled: boolean;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface RuleItem {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
}

export interface OptimizationConfig {
  hitlMode?: 'strict' | 'moderate' | 'free';
  agentMaxIterations?: number;
  tddMaxAttempts?: number;
  tddTestCommand?: string;
  terminalTimeout?: number;
}

export interface JarvisConfig {
  version: number;
  models: {
    /** `null` = aucun modèle configuré (onboarding façon Continue). */
    default: string | null;
    providers: Record<string, ProviderConfigItem>;
  };
  mcpServers?: Record<string, McpServerConfig>;
  rules?: RuleItem[];
  workflows?: Workflow[];
  agents?: SpecializedAgent[];
  optimization?: OptimizationConfig;
}

export const EMPTY_CONFIG: JarvisConfig = {
  version: 1,
  models: { default: null, providers: {} },
  optimization: {}
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge pur : objets fusionnés récursivement, tableaux et scalaires
 * remplacés en bloc par `override` (workspace gagne). Utilisé pour appliquer
 * l'override workspace par-dessus la config globale.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    if (overrideValue === undefined) continue;
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] =
      isPlainObject(baseValue) && isPlainObject(overrideValue)
        ? deepMerge(baseValue, overrideValue)
        : overrideValue;
  }
  return result as T;
}

/** Garantit la forme complète d'un objet config (défensif face au JSON utilisateur). */
export function normalizeConfig(input: unknown): JarvisConfig {
  const cfg = (isPlainObject(input) ? input : {}) as Partial<JarvisConfig>;
  const models = isPlainObject(cfg.models) ? cfg.models : { default: null, providers: {} };
  return {
    version: typeof cfg.version === 'number' ? cfg.version : 1,
    models: {
      default: (models.default ?? null) as string | null,
      providers: (isPlainObject(models.providers) ? models.providers : {}) as Record<string, ProviderConfigItem>
    },
    mcpServers: isPlainObject(cfg.mcpServers) ? cfg.mcpServers : undefined,
    rules: Array.isArray(cfg.rules) ? cfg.rules : undefined,
    workflows: Array.isArray(cfg.workflows) ? cfg.workflows : undefined,
    agents: Array.isArray(cfg.agents) ? cfg.agents : undefined,
    optimization: isPlainObject(cfg.optimization) ? cfg.optimization : {}
  };
}

export interface ConfigManagerOptions {
  /** Chemin de la config globale (défaut `~/.jarvis/config.json`). */
  globalPath?: string;
  /** Chemin de l'override workspace ; `null` désactive explicitement (utile en test). */
  workspacePath?: string | null;
}

/**
 * Source unique de vérité de la config Jarvis : charge la config globale
 * (`~/.jarvis/config.json`), la fusionne avec l'override workspace optionnel,
 * gère la migration depuis l'ancien `jarvis/jarvis-config.json`, et persiste.
 * Ne throw jamais : une config absente/illisible retombe sur `EMPTY_CONFIG`.
 */
export class ConfigManager {
  private globalPath: string;
  private workspacePath: string | undefined;
  private globalConfig: JarvisConfig;
  private merged: JarvisConfig;
  private listeners: Array<() => void> = [];

  constructor(options: ConfigManagerOptions = {}) {
    this.globalPath = options.globalPath ?? path.join(os.homedir(), '.jarvis', 'config.json');
    this.workspacePath =
      'workspacePath' in options ? options.workspacePath ?? undefined : this.resolveWorkspacePath();
    this.globalConfig = this.loadSync();
    this.merged = this.computeMerged();
  }

  private resolveWorkspacePath(): string | undefined {
    try {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return folder ? path.join(folder, 'jarvis', 'jarvis-config.json') : undefined;
    } catch {
      return undefined;
    }
  }

  private loadSync(): JarvisConfig {
    try {
      fsSync.mkdirSync(path.dirname(this.globalPath), { recursive: true });
    } catch {
      /* best-effort */
    }

    if (!fsSync.existsSync(this.globalPath)) {
      const seeded = this.migrateFromWorkspace() ?? clone(EMPTY_CONFIG);
      try {
        fsSync.writeFileSync(this.globalPath, JSON.stringify(seeded, null, 2), 'utf-8');
      } catch (err) {
        console.warn("Jarvis: impossible d'écrire la config globale:", err);
      }
      return seeded;
    }

    try {
      const raw = fsSync.readFileSync(this.globalPath, 'utf-8');
      return normalizeConfig(JSON.parse(raw));
    } catch (err) {
      console.warn('Jarvis: config globale illisible, config vide utilisée:', err);
      return clone(EMPTY_CONFIG);
    }
  }

  /** Seed la config globale depuis l'ancien fichier workspace au premier lancement. */
  private migrateFromWorkspace(): JarvisConfig | null {
    if (!this.workspacePath || !fsSync.existsSync(this.workspacePath)) return null;
    try {
      const legacy = JSON.parse(fsSync.readFileSync(this.workspacePath, 'utf-8')) as Partial<JarvisConfig>;
      if (!legacy.models) return null;
      return normalizeConfig(legacy);
    } catch {
      return null;
    }
  }

  private loadWorkspaceOverride(): Partial<JarvisConfig> | null {
    if (!this.workspacePath || !fsSync.existsSync(this.workspacePath)) return null;
    try {
      return JSON.parse(fsSync.readFileSync(this.workspacePath, 'utf-8')) as Partial<JarvisConfig>;
    } catch {
      return null;
    }
  }

  private computeMerged(): JarvisConfig {
    const override = this.loadWorkspaceOverride();
    return override ? deepMerge(this.globalConfig, override) : this.globalConfig;
  }

  /** Config effective (globale + override workspace). */
  public getConfig(): JarvisConfig {
    return this.merged;
  }

  /** Config globale brute (à éditer dans l'onglet Settings). */
  public getGlobalConfig(): JarvisConfig {
    return this.globalConfig;
  }

  public get hasWorkspace(): boolean {
    return this.workspacePath !== undefined;
  }

  public async writeGlobal(next: JarvisConfig): Promise<void> {
    this.globalConfig = normalizeConfig(next);
    await fs.mkdir(path.dirname(this.globalPath), { recursive: true });
    await fs.writeFile(this.globalPath, JSON.stringify(this.globalConfig, null, 2), 'utf-8');
    this.merged = this.computeMerged();
    this.emitChange();
  }

  public async writeWorkspace(partial: Partial<JarvisConfig>): Promise<void> {
    if (!this.workspacePath) throw new Error('Aucun workspace ouvert');
    await fs.mkdir(path.dirname(this.workspacePath), { recursive: true });
    await fs.writeFile(this.workspacePath, JSON.stringify(partial, null, 2), 'utf-8');
    this.merged = this.computeMerged();
    this.emitChange();
  }

  public async reload(): Promise<void> {
    this.globalConfig = this.loadSync();
    this.merged = this.computeMerged();
    this.emitChange();
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* isolate listener errors */
      }
    }
  }
}

let singleton: ConfigManager | null = null;

export function getConfigManager(): ConfigManager {
  if (!singleton) singleton = new ConfigManager();
  return singleton;
}

/** Réinitialise le singleton (tests uniquement). */
export function resetConfigManager(): void {
  singleton = null;
}
