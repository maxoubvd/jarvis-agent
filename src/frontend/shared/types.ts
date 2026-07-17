export type MessageKind = 'text' | 'tool' | 'thinking' | 'step' | 'plan' | 'inline';

export interface Badge {
  icon: string;
  label: string;
  variant?: 'success' | 'error' | 'warning' | 'info';
}

export interface ProcessStep {
  id: string;
  kind: 'thinking' | 'tool' | 'step';
  content: string;
  badges?: Badge[];
}

/** Item in the persistent TODO checklist (tool `update_todo_list` / workflow synthesis). */
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  kind?: MessageKind;
  badges?: Badge[];
  processSteps?: ProcessStep[];
  /** Set once the backend confirms a checkpoint was captured for this message's turn. */
  checkpointId?: string;
  /** Set once the backend confirms this message's id was actually recorded in its
   *  tracked history (message `forkable`) — only then can Fork/Rewind act on it.
   *  Stays false for turns the backend doesn't track (e.g. /tdd, /workflow, /agent,
   *  /init) and for messages rehydrated via `chatHistory` on reload, so the
   *  rewind/fork menu never appears on a message it can't actually act on.
   */
  forkable?: boolean;
}

export interface RequestTokenRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from the provider cache (0/absent if none). */
  cachedTokens?: number;
  timestamp: string;
}

export interface TokenUsage {
  used: number;
  inputTokens: number;
  outputTokens: number;
  /** Cumulative tokens served from the provider cache (cost/latency saving). */
  cachedTokens: number;
  /** Context length of the configured model; `null` if no model. */
  limit: number | null;
  percentage: number;
  level: 'green' | 'orange' | 'red';
  history: RequestTokenRecord[];
}

// --- Config (mirror of src/backend/config/config-manager.ts — keep in sync) ---

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
  'mistral',
  'gemini',
  'anthropic',
  'sambanova',
  'huggingface',
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
  huggingface: 'https://api-inference.huggingface.co/v1',
  'openai-compatible': 'https://api.openai.com/v1'
};

/** API key creation page (or docs) for each known provider. */
export const PROVIDER_KEY_PAGE: Partial<Record<ProviderType, { url: string; label: string }>> = {
  mistral: { url: 'https://console.mistral.ai/api-keys', label: 'Get API key' },
  openrouter: { url: 'https://openrouter.ai/settings/keys', label: 'Get API key' },
  openai: { url: 'https://platform.openai.com/api-keys', label: 'Get API key' },
  gemini: { url: 'https://aistudio.google.com/apikey', label: 'Get API key' },
  anthropic: { url: 'https://console.anthropic.com/settings/keys', label: 'Get API key' },
  sambanova: { url: 'https://cloud.sambanova.ai/apis', label: 'Get API key' },
  ollama: { url: 'https://ollama.com/download', label: 'Setup docs' },
  lmstudio: { url: 'https://lmstudio.ai/docs/app', label: 'Setup docs' },
  huggingface: { url: 'https://huggingface.co/settings/tokens', label: 'Get API key' }
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

/** Model-centric configuration entry (provider + key carried by the model). */
export interface ModelItem {
  name: string;
  provider: ProviderType;
  model: string;
  apiKey?: string;
  apiBase?: string;
  roles?: ModelRole[];
  contextLength?: number;
  maxTokens?: number;
  /** Sampling temperature; default: model profile, otherwise API default. */
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
  /** @deprecated Legacy — a tool listed here is equivalent to `toolPolicies[tool] = 'excluded'`. */
  disabledTools?: string[];
  /** Per-tool policy for the server (MCP default: `ask`). */
  toolPolicies?: Record<string, ToolPolicy>;
}

/** Override for a built-in MCP server (activation + per-tool policies). */
export interface BuiltinMcpOverride {
  enabled?: boolean;
  /** @deprecated Legacy — a tool listed here is equivalent to `toolPolicies[tool] = 'excluded'`. */
  disabledTools?: string[];
  /** Per-tool policy for the server (MCP default: `ask`). */
  toolPolicies?: Record<string, ToolPolicy>;
}

/** Saved prompt, invocable via `/name` in the chat. */
export interface PromptItem {
  id: string;
  name: string;
  description?: string;
  content: string;
}

/** Status of a tool exposed by an MCP server (message `mcpStatus`). */
export interface McpToolStatus {
  name: string;
  description: string;
  enabled: boolean;
  /** Effective policy (MCP default: `ask`). */
  policy: ToolPolicy;
}

/** Status of an MCP server (message `mcpStatus`). */
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
 * Execution policy for an agent tool (Continue-style):
 * auto = no confirmation, ask = always confirm, excluded = removed from registry.
 */
export type ToolPolicy = 'auto' | 'ask' | 'excluded';

export interface RuleItem {
  id: string;
  name: string;
  enabled: boolean;
  content: string;
  /** Optional glob: the rule applies only to the active matched file. Absent = global. */
  scope?: string;
}

export interface OptimizationConfig {
  hitlMode?: 'strict' | 'moderate' | 'free';
  /** Default chat mode: `agent` (tooled loop, default) or `chat` (text only). */
  chatMode?: 'agent' | 'chat';
  agentMaxIterations?: number;
  tddMaxAttempts?: number;
  tddTestCommand?: string;
  terminalTimeout?: number;
  showThinking?: boolean;
  /** Response verbosity (default: `normal`). */
  verbosity?: 'concise' | 'normal' | 'detailed';
  /** Auto-open of files edited by the agent. Default: `always`. */
  autoOpenMode?: 'always' | 'never' | 'strict-hitl-only';
  /** Inline autocomplete (Tab / ghost text). Disabled by default. */
  autocompleteEnabled?: boolean;
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
  /** Subset of allowed tools (exact names). Empty/absent = full registry. */
  allowedToolPrefixes?: string[];
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
  /** Per-agent-tool policy (name → auto/ask/excluded). */
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

/** Configuration for the `search_web` tool. Free — DuckDuckGo, no API key needed. */
export interface WebSearchConfig {
  provider: 'duckduckgo';
  /** Domains applied by default (`site:` OR) when the model doesn't specify any. */
  defaultSites?: string[];
}

/** Sources checked by default in Settings > Web Search — mirror of `config-manager.ts`. */
export const DEFAULT_WEB_SEARCH_SITES = ['stackoverflow.com', 'developer.mozilla.org', 'github.com', 'devdocs.io'];

/** Indexing status of a docs site (message `docsStatus`). */
export interface DocsSiteStatus {
  id: string;
  state: 'idle' | 'indexing' | 'done' | 'error';
  pages: number;
  indexedAt?: string;
  error?: string;
}

/** Hard-coded defaults sent by the backend with the `settings` message. */
export interface SettingsDefaults {
  agents: SpecializedAgent[];
  workflows: Workflow[];
  builtinMcp?: Array<{
    id: string;
    label: string;
    description: string;
    command: string;
    defaultEnabled: boolean;
    /** Folder opened but not a git repo — enabling requires a "git init" (confirmation). */
    requiresGitInit?: boolean;
  }>;
  /** Built-in agent tools — for the policy editor. */
  agentTools?: Array<{ name: string; description: string }>;
  /** Custom tools from jarvis-tools/*.json (read-only in the UI). */
  customTools?: Array<{ name: string; description: string }>;
}

/** HITL approval request displayed in the chat (message `approvalRequest`). */
export interface ApprovalRequest {
  id: string;
  actionType: string;
  description: string;
  detail: string;
}

/** Hunk of a diff awaiting review (mirror of services/diff.ts). */
export interface DiffHunkView {
  id: number;
  beforeStart: number;
  afterStart: number;
  beforeLines: string[];
  afterLines: string[];
  contextBefore: string[];
  contextAfter: string[];
}

/** File modified by the AI awaiting review (message `pendingChanges`). */
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
