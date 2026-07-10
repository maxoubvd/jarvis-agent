import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { Workflow } from '../services/workflows.js';
import type { SpecializedAgent } from '../services/agents.js';

export type ProviderType =
  | 'ollama'
  | 'openai'
  | 'openrouter'
  | 'lmstudio'
  | 'mistral'
  | 'gemini'
  | 'anthropic'
  | 'sambanova'
  | 'huggingface'
  | 'openai-compatible';

export const PROVIDER_TYPES: ProviderType[] = [
  'ollama',
  'openai',
  'openrouter',
  'lmstudio',
  'gemini',
  'anthropic',
  'sambanova',
  'mistral',
  'huggingface',
  'openai-compatible'
];

/** Base URL par défaut de chaque provider (surchargée par `ModelItem.apiBase`). */
export const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  mistral: 'https://api.mistral.ai/v1',
  // Endpoints « OpenAI-compatible » officiels de chaque fournisseur.
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  huggingface: 'https://api-inference.huggingface.co/v1',
  'openai-compatible': 'https://api.openai.com/v1'
};

export type ModelRole = 'chat' | 'edit' | 'apply' | 'autocomplete' | 'embed' | 'rerank' | 'summarize';

export const MODEL_ROLES: ModelRole[] = [
  'chat',
  'edit',
  'apply',
  'autocomplete',
  'embed',
  'rerank',
  'summarize'
];

/** Rôles attribués à un modèle migré depuis l'ancien schéma centré provider. */
export const DEFAULT_MODEL_ROLES: ModelRole[] = ['chat', 'edit', 'apply'];

/**
 * Entrée de modèle centrée « modèle » (façon Continue) : chaque modèle porte
 * son provider, sa clé API et ses rôles. `name` est l'identifiant d'affichage
 * (unique, référencé par `models.default`), `model` l'id envoyé à l'API.
 */
export interface ModelItem {
  name: string;
  provider: ProviderType;
  model: string;
  apiKey?: string;
  /** Base URL personnalisée ; défaut : `DEFAULT_BASE_URL[provider]`. */
  apiBase?: string;
  roles?: ModelRole[];
  contextLength?: number;
  maxTokens?: number;
  /** Température d'échantillonnage ; défaut : profil du modèle, sinon défaut de l'API. */
  temperature?: number;
  /** Défaut : true. */
  enabled?: boolean;
}

/** @deprecated Ancien schéma centré provider — conservé pour la migration. */
export interface ModelConfigItem {
  name: string;
  contextLength: number;
}

/** @deprecated Ancien schéma centré provider — conservé pour la migration. */
export interface ProviderConfigItem {
  enabled: boolean;
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
  /** @deprecated Legacy — un tool listé ici équivaut à `toolPolicies[tool] = 'excluded'`. */
  disabledTools?: string[];
  /** Politique par tool du serveur (défaut MCP : `ask`). */
  toolPolicies?: Record<string, ToolPolicy>;
}

/** Override d'un serveur MCP intégré (activation + politiques par tool). */
export interface BuiltinMcpOverride {
  enabled?: boolean;
  /** @deprecated Legacy — un tool listé ici équivaut à `toolPolicies[tool] = 'excluded'`. */
  disabledTools?: string[];
  /** Politique par tool du serveur (défaut MCP : `ask`). */
  toolPolicies?: Record<string, ToolPolicy>;
}

/** Prompt enregistré, invocable via `/nom` dans le chat (section Prompts). */
export interface PromptItem {
  id: string;
  name: string;
  description?: string;
  content: string;
}

export interface RuleItem {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
}

export interface OptimizationConfig {
  hitlMode?: 'strict' | 'moderate' | 'free';
  /** Mode du chat par défaut : `agent` (boucle outillée, défaut) ou `chat` (texte seul). */
  chatMode?: 'agent' | 'chat';
  agentMaxIterations?: number;
  tddMaxAttempts?: number;
  tddTestCommand?: string;
  terminalTimeout?: number;
  /** Affichage des blocs <thinking> dans le chat (défaut : true). */
  showThinking?: boolean;
  /** Verbosité des réponses (défaut : `normal` = aucune consigne ajoutée). */
  verbosity?: 'concise' | 'normal' | 'detailed';
}

/** Site de documentation externe mis en cache et indexé (section Docs). */
export interface DocSite {
  id: string;
  title: string;
  startUrl: string;
  enabled: boolean;
}

/**
 * Politique d'exécution d'un outil de l'agent (façon Continue) :
 * - `auto` : exécuté sans confirmation, quel que soit le mode HITL ;
 * - `ask` : confirmation demandée à chaque fois, même en mode free ;
 * - `excluded` : retiré du registre (invisible pour le modèle).
 * Absent = comportement du mode HITL courant.
 */
export type ToolPolicy = 'auto' | 'ask' | 'excluded';

/**
 * Profil de workspace : instructions type CLAUDE.md injectées dans le prompt système
 * quand actif. Pur profil de contexte — ne change PAS le dossier accessible à l'agent
 * (toujours celui ouvert dans VS Code, cf. SandboxManager).
 */
export interface WorkspaceProfile {
  id: string;
  name: string;
  instructions: string;
  enabled: boolean;
}

export interface JarvisConfig {
  version: number;
  models: {
    /** `null` = aucun modèle configuré (onboarding façon Continue). */
    default: string | null;
    items: ModelItem[];
  };
  mcpServers?: Record<string, McpServerConfig>;
  /** Overrides des serveurs MCP de base (définis dans le code). */
  builtinMcp?: Record<string, BuiltinMcpOverride>;
  /** Politique par outil de l'agent (nom → auto/ask/excluded). */
  toolPolicies?: Record<string, ToolPolicy>;
  rules?: RuleItem[];
  workflows?: Workflow[];
  agents?: SpecializedAgent[];
  prompts?: PromptItem[];
  docs?: DocSite[];
  workspaces?: WorkspaceProfile[];
  activeWorkspaceId?: string | null;
  optimization?: OptimizationConfig;
  firstName?: string;
}

export const EMPTY_CONFIG: JarvisConfig = {
  version: 1,
  models: { default: null, items: [] },
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

/** Coercition défensive d'une entrée de modèle venue du JSON utilisateur. */
function normalizeModelItem(raw: unknown): ModelItem | null {
  if (!isPlainObject(raw)) return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const provider = PROVIDER_TYPES.includes(raw.provider as ProviderType)
    ? (raw.provider as ProviderType)
    : 'openai-compatible';
  const item: ModelItem = {
    name,
    provider,
    model: typeof raw.model === 'string' && raw.model.trim() ? raw.model.trim() : name
  };
  if (typeof raw.apiKey === 'string' && raw.apiKey) item.apiKey = raw.apiKey;
  if (typeof raw.apiBase === 'string' && raw.apiBase) item.apiBase = raw.apiBase;
  if (Array.isArray(raw.roles)) {
    const roles = raw.roles.filter((r): r is ModelRole => MODEL_ROLES.includes(r as ModelRole));
    if (roles.length > 0) item.roles = roles;
  }
  if (typeof raw.contextLength === 'number' && raw.contextLength > 0) {
    item.contextLength = Math.floor(raw.contextLength);
  }
  if (typeof raw.maxTokens === 'number' && raw.maxTokens > 0) {
    item.maxTokens = Math.floor(raw.maxTokens);
  }
  if (typeof raw.temperature === 'number' && raw.temperature >= 0 && raw.temperature <= 2) {
    item.temperature = raw.temperature;
  }
  if (raw.enabled === false) item.enabled = false;
  return item;
}

/** Type de provider déduit d'une clé de l'ancien schéma (clé inconnue => openai-compatible). */
function inferProviderType(providerKey: string): ProviderType {
  return PROVIDER_TYPES.includes(providerKey as ProviderType) && providerKey !== 'openai-compatible'
    ? (providerKey as ProviderType)
    : 'openai-compatible';
}

/** Migre l'ancien schéma centré provider (`models.providers`) vers `ModelItem[]`. */
function migrateLegacyProviders(providers: Record<string, unknown>): ModelItem[] {
  const items: ModelItem[] = [];
  const usedNames = new Set<string>();
  for (const [key, value] of Object.entries(providers)) {
    if (!isPlainObject(value)) continue;
    const legacy = value as Partial<ProviderConfigItem>;
    const type = (legacy.type as ProviderType | undefined) ?? inferProviderType(key);
    for (const model of Array.isArray(legacy.models) ? legacy.models : []) {
      if (!isPlainObject(model) || typeof model.name !== 'string' || !model.name.trim()) continue;
      // Le premier occupant garde le nom (models.default continue de résoudre).
      const name = usedNames.has(model.name) ? `${model.name} (${key})` : model.name;
      usedNames.add(name);
      const item = normalizeModelItem({
        name,
        provider: type,
        model: model.name,
        apiKey: legacy.apiKey,
        apiBase: legacy.baseUrl,
        contextLength: model.contextLength,
        enabled: legacy.enabled,
        roles: DEFAULT_MODEL_ROLES
      });
      if (item) items.push(item);
    }
  }
  return items;
}

/**
 * Normalise la section `models`, en migrant l'ancienne forme `providers` vers
 * `items` si nécessaire. Idempotent : une section déjà au nouveau format est
 * seulement coercée, jamais re-migrée.
 */
export function normalizeModelsSection(raw: unknown): JarvisConfig['models'] {
  const models = isPlainObject(raw) ? raw : {};
  const defaultModel = typeof models.default === 'string' && models.default ? models.default : null;
  if (Array.isArray(models.items)) {
    return {
      default: defaultModel,
      items: models.items.map(normalizeModelItem).filter((m): m is ModelItem => m !== null)
    };
  }
  if (isPlainObject(models.providers)) {
    return { default: defaultModel, items: migrateLegacyProviders(models.providers) };
  }
  return { default: defaultModel, items: [] };
}

/** Garantit la forme complète d'un objet config (défensif face au JSON utilisateur). */
export function normalizeConfig(input: unknown): JarvisConfig {
  const cfg = (isPlainObject(input) ? input : {}) as Partial<JarvisConfig>;
  return {
    version: typeof cfg.version === 'number' ? cfg.version : 1,
    models: normalizeModelsSection(cfg.models),
    mcpServers: isPlainObject(cfg.mcpServers) ? cfg.mcpServers : undefined,
    builtinMcp: isPlainObject(cfg.builtinMcp)
      ? (cfg.builtinMcp as Record<string, BuiltinMcpOverride>)
      : undefined,
    toolPolicies: isPlainObject(cfg.toolPolicies)
      ? (Object.fromEntries(
          Object.entries(cfg.toolPolicies).filter(([, v]) => v === 'auto' || v === 'ask' || v === 'excluded')
        ) as Record<string, ToolPolicy>)
      : undefined,
    rules: Array.isArray(cfg.rules) ? cfg.rules : undefined,
    workflows: Array.isArray(cfg.workflows) ? cfg.workflows : undefined,
    agents: Array.isArray(cfg.agents) ? cfg.agents : undefined,
    prompts: Array.isArray(cfg.prompts) ? cfg.prompts : undefined,
    docs: Array.isArray(cfg.docs) ? cfg.docs : undefined,
    workspaces: Array.isArray(cfg.workspaces) ? cfg.workspaces : undefined,
    activeWorkspaceId: typeof cfg.activeWorkspaceId === 'string' ? cfg.activeWorkspaceId : undefined,
    optimization: isPlainObject(cfg.optimization) ? cfg.optimization : {},
    firstName: typeof cfg.firstName === 'string' ? cfg.firstName : undefined
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
    if (!override) return this.globalConfig;
    // L'override est partiel : on ne migre que sa section models si elle est
    // présente, sans introduire de clés fantômes (`default: null` ou `items: []`)
    // qui écraseraient la config globale.
    if (isPlainObject(override.models)) {
      const rawModels = override.models as Record<string, unknown>;
      const migrated = normalizeModelsSection(override.models);
      const partial: Partial<JarvisConfig['models']> = {};
      if (rawModels.items !== undefined || rawModels.providers !== undefined) {
        partial.items = migrated.items;
      }
      if (rawModels.default !== undefined) {
        partial.default = migrated.default;
      }
      override.models = partial as JarvisConfig['models'];
    }
    return deepMerge(this.globalConfig, override);
  }

  /** Config effective (globale + override workspace). */
  public getConfig(): JarvisConfig {
    return this.merged;
  }

  /** Config globale brute (à éditer dans l'onglet Settings). */
  public getGlobalConfig(): JarvisConfig {
    return this.globalConfig;
  }

  /** Chemin du fichier de config globale (~/.jarvis/config.json). */
  public getGlobalConfigPath(): string {
    return this.globalPath;
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
