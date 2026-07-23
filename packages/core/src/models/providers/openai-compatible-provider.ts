import { IModelProvider, ChatMessage, SendPromptResult, NativeToolCall, SendOptions, ProviderUsage } from '../abstract.js';
import { ToolDefinition } from '../../core/agent/tool-registry.js';
import { openaiCompatibleSend, openaiCompatibleStream, OpenAICompatibleConfig } from './openai-compatible.js';

export interface OpenAICompatibleProviderOptions {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
  extraHeaders?: Record<string, string>;
}

/**
 * Generic provider for any OpenAI-compatible endpoint added by
 * the user (Continue-style). Wraps the shared helpers.
 */
export class OpenAICompatibleProvider implements IModelProvider {
  public name: string;
  private config: OpenAICompatibleConfig;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.name = options.name;
    this.config = {
      baseUrl: options.baseUrl.replace(/\/$/, ''),
      model: options.model,
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      extraHeaders: options.extraHeaders
    };
  }

  public async sendPrompt(messages: ChatMessage[], tools?: ToolDefinition[], signal?: AbortSignal, options?: SendOptions): Promise<SendPromptResult> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI Compatible: API key missing from jarvis-config.json');
    }
    return openaiCompatibleSend(this.config, messages, tools, signal, options);
  }

  public async sendPromptStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: (toolCalls?: NativeToolCall[], usage?: ProviderUsage) => void,
    onError: (err: Error) => void,
    tools?: ToolDefinition[],
    signal?: AbortSignal,
    options?: SendOptions
  ): Promise<void> {
    if (!this.config.apiKey) {
      onError(new Error('OpenAI Compatible: API key missing from jarvis-config.json'));
      return;
    }
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError, tools, signal, options);
  }
}
