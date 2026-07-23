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

/** Token statistics returned by the API (including implicit cache). */
export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  /** Prompt tokens served from cache (OpenAI/DeepSeek). */
  cachedTokens?: number;
}

export interface SendPromptResult {
  text: string;
  toolCalls?: NativeToolCall[];
  usage?: ProviderUsage;
}

/** Per-call options (JSON mode is only enabled for the agent loop). */
export interface SendOptions {
  /**
   * Forces parseable JSON via the API (`response_format`/`format`), instead of
   * relying on the prompt + json-cleaner. `text` = default behaviour.
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
