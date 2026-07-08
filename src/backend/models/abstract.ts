import { ToolDefinition } from '../core/agent/tool-registry.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: NativeToolCall[];
  tool_call_id?: string;
}

export interface NativeToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** Statistiques de tokens renvoyées par l'API (dont le cache implicite). */
export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  /** Tokens du prompt servis depuis le cache (OpenAI/DeepSeek). */
  cachedTokens?: number;
}

export interface SendPromptResult {
  text: string;
  toolCalls?: NativeToolCall[];
  usage?: ProviderUsage;
}

/** Options par appel (le mode JSON n'est activé que pour la boucle agent). */
export interface SendOptions {
  /**
   * Force un JSON parsable via l'API (`response_format`/`format`), plutôt que de
   * s'en remettre au prompt + json-cleaner. `text` = comportement par défaut.
   */
  responseFormat?: 'json_object' | 'text';
}

export interface IModelProvider {
  name: string;
  sendPrompt(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    signal?: AbortSignal,
    options?: SendOptions
  ): Promise<SendPromptResult | string>;
  sendPromptStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: (toolCalls?: NativeToolCall[], usage?: ProviderUsage) => void,
    onError: (err: Error) => void,
    tools?: ToolDefinition[],
    signal?: AbortSignal,
    options?: SendOptions
  ): Promise<void>;
}
