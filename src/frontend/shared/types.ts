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
  limit: number;
  percentage: number;
  level: 'green' | 'orange' | 'red';
  history: RequestTokenRecord[];
}

// --- Config (miroir de src/backend/config/config-manager.ts — garder synchronisé) ---

export type ProviderType = 'ollama' | 'openrouter' | 'lmstudio' | 'mistral' | 'openai-compatible';

export interface ModelConfigItem {
  name: string;
  contextLength: number;
}

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
    default: string | null;
    providers: Record<string, ProviderConfigItem>;
  };
  mcpServers?: Record<string, McpServerConfig>;
  rules?: RuleItem[];
  /** Édités en Phase 2+ ; transmis tels quels par la Settings UI. */
  workflows?: unknown[];
  agents?: unknown[];
  optimization?: OptimizationConfig;
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
