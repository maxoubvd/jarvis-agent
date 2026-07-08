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
 * Provider générique pour tout endpoint OpenAI-compatible ajouté par
 * l'utilisateur (façon Continue). Enveloppe les helpers partagés.
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
      throw new Error('OpenAI Compatible: clé API manquante dans jarvis-config.json');
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
      onError(new Error('OpenAI Compatible: clé API manquante dans jarvis-config.json'));
      return;
    }
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError, tools, signal, options);
  }
}
