import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWorkspaceRoot } from '../core/utils/workspace.js';
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

/** Default base URL for each provider (overridden by `ModelItem.apiBase`). */
export const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  mistral: 'https://api.mistral.ai/v1',
  // Official "OpenAI-compatible" endpoints for each provider.
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

/** Roles assigned to a model migrated from the old provider-centric schema. */
export const DEFAULT_MODEL_ROLES: ModelRole[] = ['chat', 'edit', 'apply'];

/**
 * "Model"-centric model entry (Continue-style): each model carries its own
 * provider, API key, and roles. `name` is the display identifier (unique,
 * referenced by `models.default`), `model` is the id sent to the API.
 */
export interface ModelItem {
  name: string;
  provider: ProviderType;
  model: string;
  apiKey?: string;
  /** Custom base URL; defaults to `DEFAULT_BASE_URL[provider]`. */
  apiBase?: string;
  roles?: ModelRole[];
  contextLength?: number;
  maxTokens?: number;
  /** Sampling temperature; defaults to the model's profile, otherwise the API default. */
  temperature?: number;
  /** Default: true. */
  enabled?: boolean;
}

/** @deprecated Old provider-centric schema — kept for migration purposes. */
export interface ModelConfigItem {
  name: string;
  contextLength: number;
}

/** @deprecated Old provider-centric schema — kept for migration purposes. */
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
  /** @deprecated Legacy — a tool listed here is equivalent to `toolPolicies[tool] = 'excluded'`. */
  disabledTools?: string[];
  /** Per-tool policy for the server (MCP default: `ask`). */
  toolPolicies?: Record<string, ToolPolicy>;
}

/** Override for a built-in MCP server (enable flag + per-tool policies). */
export interface BuiltinMcpOverride {
  enabled?: boolean;
  /** @deprecated Legacy — a tool listed here is equivalent to `toolPolicies[tool] = 'excluded'`. */
  disabledTools?: string[];
  /** Per-tool policy for the server (MCP default: `ask`). */
  toolPolicies?: Record<string, ToolPolicy>;
}

/** Saved prompt, invocable via `/name` in the chat (Prompts section). */
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
  /** Optional glob (e.g. `src/backend/**`): the rule only applies when it matches the active file. Absent = global. */
  scope?: string;
}

export interface OptimizationConfig {
  hitlMode?: 'strict' | 'moderate' | 'free';
  /** Default chat mode: `agent` (tool-using loop, default) or `chat` (text only). */
  chatMode?: 'agent' | 'chat';
  agentMaxIterations?: number;
  tddMaxAttempts?: number;
  tddTestCommand?: string;
  terminalTimeout?: number;
  /** Whether to show <thinking> blocks in the chat (default: true). */
  showThinking?: boolean;
  /** Response verbosity (default: `normal` = no extra instruction added). */
  verbosity?: 'concise' | 'normal' | 'detailed';
  /**
   * Automatically opens the file edited by the agent (preview tab, reused across
   * edits). `strict-hitl-only`: only opens in strict HITL mode. Default: `always`.
   */
  autoOpenMode?: 'always' | 'never' | 'strict-hitl-only';
  /**
   * Inline autocomplete (Tab / ghost text) — calls a model on every typing pause.
   * Disabled by default: the cost/latency isn't negligible for a feature that's
   * always triggered automatically, so it should be enabled explicitly once validated by usage.
   */
  autocompleteEnabled?: boolean;
}

/** External documentation site, cached and indexed (Docs section). */
export interface DocSite {
  id: string;
  title: string;
  startUrl: string;
  enabled: boolean;
}

/**
 * Execution policy for an agent tool (Continue-style):
 * - `auto`: executed without confirmation, regardless of HITL mode;
 * - `ask`: confirmation requested every time, even in free mode;
 * - `excluded`: removed from the registry (invisible to the model).
 * Absent = behavior of the current HITL mode.
 */
export type ToolPolicy = 'auto' | 'ask' | 'excluded';

/**
 * Workspace profile: CLAUDE.md-style instructions injected into the system prompt
 * when active. Pure context profile — does NOT change the folder the agent can
 * access (always the one open in VS Code, see SandboxManager).
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
    /** `null` = no model configured (Continue-style onboarding). */
    default: string | null;
    items: ModelItem[];
  };
  mcpServers?: Record<string, McpServerConfig>;
  /** Overrides for the base MCP servers (defined in code). */
  builtinMcp?: Record<string, BuiltinMcpOverride>;
  /** Per-tool policy for the agent (name → auto/ask/excluded). */
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
  webSearch?: WebSearchConfig;
}

/** Configuration for the `search_web` tool (§4.2). Free — DuckDuckGo, no API key. */
export interface WebSearchConfig {
  provider: 'duckduckgo';
  /** Domains applied by default (`site:` OR) when the model doesn't specify any. */
  defaultSites?: string[];
}

/**
 * Sources checked by default in Settings > Web Search. Also used here (`webSearch.ts`)
 * when the user has never opened/saved that screen (`cfg.defaultSites` is then `undefined`).
 */
export const DEFAULT_WEB_SEARCH_SITES = ['stackoverflow.com', 'developer.mozilla.org', 'github.com', 'devdocs.io'];

/**
 * Seed rule shipped disabled for every new install, as a usage example
 * (Settings > Rules). Users toggle it on or delete it freely.
 */
const DEFAULT_EXAMPLE_RULE: RuleItem = {
  id: 'default-example-commentator',
  name: 'Commentator',
  enabled: false,
  content: 'Always comment your work professionnally.'
};

/**
 * Seed prompt shipped for every new install, as a usage example of a
 * reusable text shortcut invocable via `/explain` (Settings > Prompts).
 */
const DEFAULT_EXAMPLE_PROMPT: PromptItem = {
  id: 'default-example-explain',
  name: 'explain',
  description: 'Explains the selected code line by line like a senior mentor.',
  content:
    'Act as a senior mentor. Explain the following code line by line, focusing on time complexity, potential edge cases, and the underlying logic. Do not rewrite the code, just explain it.'
};

export const EMPTY_CONFIG: JarvisConfig = {
  version: 1,
  models: { default: null, items: [] },
  optimization: {}
};

/**
 * Config written on first launch (no `~/.jarvis/config.json` yet), i.e. what
 * every new user starts from — `EMPTY_CONFIG` plus the disabled example
 * rule/prompt. Kept separate from `EMPTY_CONFIG` itself, which must stay the
 * bare normalized shape (`normalizeConfig(null) === EMPTY_CONFIG`).
 */
function seedDefaultConfig(): JarvisConfig {
  return { ...clone(EMPTY_CONFIG), rules: [clone(DEFAULT_EXAMPLE_RULE)], prompts: [clone(DEFAULT_EXAMPLE_PROMPT)] };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Pure deep-merge: objects are merged recursively, arrays and scalars are
 * replaced wholesale by `override` (workspace wins). Used to apply the
 * workspace override on top of the global config.
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

/** Defensive coercion of a model entry coming from user JSON. */
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

/** Provider type inferred from a legacy-schema key (unknown key => openai-compatible). */
function inferProviderType(providerKey: string): ProviderType {
  return PROVIDER_TYPES.includes(providerKey as ProviderType) && providerKey !== 'openai-compatible'
    ? (providerKey as ProviderType)
    : 'openai-compatible';
}

/** Migrates the old provider-centric schema (`models.providers`) to `ModelItem[]`. */
function migrateLegacyProviders(providers: Record<string, unknown>): ModelItem[] {
  const items: ModelItem[] = [];
  const usedNames = new Set<string>();
  for (const [key, value] of Object.entries(providers)) {
    if (!isPlainObject(value)) continue;
    const legacy = value as Partial<ProviderConfigItem>;
    const type = (legacy.type as ProviderType | undefined) ?? inferProviderType(key);
    for (const model of Array.isArray(legacy.models) ? legacy.models : []) {
      if (!isPlainObject(model) || typeof model.name !== 'string' || !model.name.trim()) continue;
      // The first occupant keeps the name (models.default keeps resolving).
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
 * Normalizes the `models` section, migrating the old `providers` shape to
 * `items` if needed. Idempotent: a section already in the new format is
 * only coerced, never re-migrated.
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

/** Ensures the full shape of a config object (defensive against user JSON). */
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
  /** Path to the global config (default `~/.jarvis/config.json`). */
  globalPath?: string;
  /** Path to the workspace override; `null` explicitly disables it (useful in tests). */
  workspacePath?: string | null;
}

/**
 * Single source of truth for the Jarvis config: loads the global config
 * (`~/.jarvis/config.json`), merges it with the optional workspace override,
 * handles migration from the old `jarvis/jarvis-config.json`, and persists.
 * Never throws: a missing/unreadable config falls back to `EMPTY_CONFIG`.
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
      const folder = getWorkspaceRoot();
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
      const seeded = this.migrateFromWorkspace() ?? seedDefaultConfig();
      try {
        fsSync.writeFileSync(this.globalPath, JSON.stringify(seeded, null, 2), 'utf-8');
      } catch (err) {
        console.warn('Jarvis: unable to write the global config:', err);
      }
      return seeded;
    }

    try {
      const raw = fsSync.readFileSync(this.globalPath, 'utf-8');
      return normalizeConfig(JSON.parse(raw));
    } catch (err) {
      console.warn('Jarvis: global config unreadable, using empty config:', err);
      return clone(EMPTY_CONFIG);
    }
  }

  /** Seeds the global config from the old workspace file on first launch. */
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
    // The override is partial: we only migrate its models section if present,
    // without introducing phantom keys (`default: null` or `items: []`) that
    // would overwrite the global config.
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

  /** Effective config (global + workspace override). */
  public getConfig(): JarvisConfig {
    return this.merged;
  }

  /** Raw global config (edited in the Settings tab). */
  public getGlobalConfig(): JarvisConfig {
    return this.globalConfig;
  }

  /** Path to the global config file (~/.jarvis/config.json). */
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
    if (!this.workspacePath) throw new Error('No workspace open');
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

/** Resets the singleton (tests only). */
export function resetConfigManager(): void {
  singleton = null;
}
