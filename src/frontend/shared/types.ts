export type MessageKind = 'text' | 'tool' | 'thinking' | 'step';

export interface Badge {
  icon: string;
  label: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  kind?: MessageKind;
  badges?: Badge[];
}

export interface RequestTokenRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

export interface TokenUsage {
  used: number;
  inputTokens: number;
  outputTokens: number;
  /** Longueur de contexte du modèle configuré ; `null` si aucun modèle. */
  limit: number | null;
  percentage: number;
  level: 'green' | 'orange' | 'red';
  history: RequestTokenRecord[];
}

// --- Config (miroir de src/backend/config/config-manager.ts — garder synchronisé) ---

export type ProviderType =
  | 'ollama'
  | 'openai'
  | 'openrouter'
  | 'lmstudio'
  | 'mistral'
  | 'openai-compatible';

export const PROVIDER_TYPES: ProviderType[] = [
  'ollama',
  'openai',
  'openrouter',
  'lmstudio',
  'mistral',
  'openai-compatible'
];

export const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  mistral: 'https://api.mistral.ai/v1',
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

export type ModelCapability = 'tool_use' | 'image_input';

export const MODEL_CAPABILITIES: ModelCapability[] = ['tool_use', 'image_input'];

/** Entrée de modèle centrée « modèle » (façon Continue). */
export interface ModelItem {
  name: string;
  provider: ProviderType;
  model: string;
  apiKey?: string;
  apiBase?: string;
  roles?: ModelRole[];
  capabilities?: ModelCapability[];
  contextLength?: number;
  maxTokens?: number;
  enabled?: boolean;
}

export interface McpServerConfig {
  enabled: boolean;
  transport: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Tools de ce serveur désactivés individuellement. */
  disabledTools?: string[];
}

/** Override d'un serveur MCP intégré (activation + tools désactivés). */
export interface BuiltinMcpOverride {
  enabled?: boolean;
  disabledTools?: string[];
}

/** Prompt enregistré, invocable via `/nom` dans le chat. */
export interface PromptItem {
  id: string;
  name: string;
  description?: string;
  content: string;
}

/** Statut d'un tool exposé par un serveur MCP (message `mcpStatus`). */
export interface McpToolStatus {
  name: string;
  description: string;
  enabled: boolean;
}

/** Statut d'un serveur MCP (message `mcpStatus`). */
export interface McpServerStatus {
  name: string;
  enabled: boolean;
  connected: boolean;
  tools: McpToolStatus[];
  error?: string;
  builtin?: boolean;
  description?: string;
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
  showThinking?: boolean;
}

export interface WorkflowStep {
  name: string;
  prompt: string;
}

export interface Workflow {
  id: string;
  label: string;
  description: string;
  steps: WorkflowStep[];
}

export interface SpecializedAgent {
  id: string;
  mention: string;
  label: string;
  description: string;
  systemPrompt: string;
  keywords: string[];
}

export interface DocSite {
  id: string;
  title: string;
  startUrl: string;
  enabled: boolean;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  folder: string;
  instructions: string;
  enabled: boolean;
}

export interface JarvisConfig {
  version: number;
  models: {
    default: string | null;
    items: ModelItem[];
  };
  mcpServers?: Record<string, McpServerConfig>;
  builtinMcp?: Record<string, BuiltinMcpOverride>;
  rules?: RuleItem[];
  workflows?: Workflow[];
  agents?: SpecializedAgent[];
  prompts?: PromptItem[];
  docs?: DocSite[];
  workspaces?: WorkspaceProfile[];
  activeWorkspaceId?: string | null;
  optimization?: OptimizationConfig;
}

/** Statut d'indexation d'un site de docs (message `docsStatus`). */
export interface DocsSiteStatus {
  id: string;
  state: 'idle' | 'indexing' | 'done' | 'error';
  pages: number;
  indexedAt?: string;
  error?: string;
}

/** Défauts codés en dur envoyés par le backend avec le message `settings`. */
export interface SettingsDefaults {
  agents: SpecializedAgent[];
  workflows: Workflow[];
  builtinMcp?: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
    defaultEnabled: boolean;
  }>;
  /** Outils personnalisés jarvis-tools/*.json (lecture seule dans l'UI). */
  customTools?: Array<{ name: string; description: string }>;
}

export interface AnalyticsStats {
  summary: { totalActions: number; totalTokens: number; successCount: number };
  models: Record<string, { tokensUsed: number; actions: number; successCount: number }>;
  actionsByType: Record<string, { count: number; successCount: number }>;
  recentActions: Array<{
    id: string;
    timestamp: string;
    type: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    duration: number;
    status: 'success' | 'error';
  }>;
}
