export interface ModelConfig {
  default: string;
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey?: string;
  models: Array<{ name: string; contextLength: number }>;
}
