import { IModelProvider, ChatMessage, SendPromptResult, NativeToolCall, SendOptions, ProviderUsage } from '../abstract.js';
import { ToolDefinition } from '../../core/agent/tool-registry.js';
import { openaiCompatibleSend, openaiCompatibleStream, OpenAICompatibleConfig } from './openai-compatible.js';

export interface MistralOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Mistral API (cloud) — mistral-large, codestral (spec §3.1). */
export class MistralProvider implements IModelProvider {
  public name = 'mistral';
  private config: OpenAICompatibleConfig;

  constructor(options: MistralOptions = {}) {
    this.config = {
      baseUrl: (options.baseUrl ?? 'https://api.mistral.ai/v1').replace(/\/$/, ''),
      model: options.model ?? 'codestral-latest',
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      temperature: options.temperature
    };
  }

  public async sendPrompt(messages: ChatMessage[], tools?: ToolDefinition[], signal?: AbortSignal, options?: SendOptions): Promise<SendPromptResult> {
    if (!this.config.apiKey) {
      throw new Error('Mistral: API key missing from jarvis-config.json');
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
      onError(new Error('Mistral: API key missing from jarvis-config.json'));
      return;
    }
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError, tools, signal, options);
  }
}
