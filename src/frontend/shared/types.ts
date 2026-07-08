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
  | 'gemini'
  | 'anthropic'
  | 'sambanova'
  | 'openai-compatible';

export const PROVIDER_TYPES: ProviderType[] = [
  'ollama',
  'openai',
  'openrouter',
  'lmstudio',
  'mistral',
  'gemini',
  'anthropic',
  'sambanova',
  'openai-compatible'
];

export const DEFAULT_BASE_URL: Record<ProviderType, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  lmstudio: 'http://localhost:1234/v1',
  mistral: 'https://api.mistral.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  anthropic: 'https://api.anthropic.com/v1',
  sambanova: 'https://api.sambanova.ai/v1',
  'openai-compatible': 'https://api.openai.com/v1'
};

/** Page de création de clé API (ou docs) de chaque provider connu. */
export const PROVIDER_KEY_PAGE: Partial<Record<ProviderType, { url: string; label: string }>> = {
  mistral: { url: 'https://console.mistral.ai/api-keys', label: 'Get API key' },
  openrouter: { url: 'https://openrouter.ai/settings/keys', label: 'Get API key' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'Get API key' },
  gemini: { url: 'https://aistudio.google.com/apikey', label: 'Get API key' },
  anthropic: { url: 'https://console.anthropic.com/settings/keys', label: 'Get API key' },
  sambanova: { url: 'https://cloud.sambanova.ai/apis', label: 'Get API key' },
  ollama: { url: 'https://ollama.com/download', label: 'Setup docs' },
  lmstudio: { url: 'https://lmstudio.ai/docs/app', label: 'Setup docs' }
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

/** Entrée de configuration centrée « modèle » (provider + clé portés par le modèle). */
export interface ModelItem {
  name: string;
  provider: ProviderType;
  model: string;
  apiKey?: string;
  apiBase?: string;
  roles?: ModelRole[];
  contextLength?: number;
  maxTokens?: number;
  /** Température d'échantillonnage ; défaut : profil du modèle, sinon défaut de l'API. */
  temperature?: number;
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
  /** Politique effective (défaut MCP : `ask`). */
  policy: ToolPolicy;
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

/**
 * Politique d'exécution d'un outil de l'agent (façon Continue) :
 * auto = sans confirmation, ask = toujours demander, excluded = retiré du registre.
 */
export type ToolPolicy = 'auto' | 'ask' | 'excluded';

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
  showThinking?: boolean;
  /** Verbosité des réponses (défaut : `normal`). */
  verbosity?: 'concise' | 'normal' | 'detailed';
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
  /** Outils intégrés de l'agent — pour l'éditeur de politiques. */
  agentTools?: Array<{ name: string; description: string }>;
  /** Outils personnalisés jarvis-tools/*.json (lecture seule dans l'UI). */
  customTools?: Array<{ name: string; description: string }>;
}

/** Demande d'approbation HITL affichée dans le chat (message `approvalRequest`). */
export interface ApprovalRequest {
  id: string;
  actionType: string;
  description: string;
  detail: string;
}

/** Hunk d'un diff en attente de revue (miroir de services/diff.ts). */
export interface DiffHunkView {
  id: number;
  beforeStart: number;
  afterStart: number;
  beforeLines: string[];
  afterLines: string[];
  contextBefore: string[];
  contextAfter: string[];
}

/** Fichier modifié par l'IA en attente de revue (message `pendingChanges`). */
export interface PendingFileChange {
  path: string;
  isNew: boolean;
  revision: number;
  hunks: DiffHunkView[];
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
