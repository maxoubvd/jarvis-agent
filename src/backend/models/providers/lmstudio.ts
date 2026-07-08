import { IModelProvider, ChatMessage, SendPromptResult, NativeToolCall, SendOptions, ProviderUsage } from '../abstract.js';
import { ToolDefinition } from '../../core/agent/tool-registry.js';
import { openaiCompatibleSend, openaiCompatibleStream, OpenAICompatibleConfig } from './openai-compatible.js';

export interface LMStudioOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export class LMStudioProvider implements IModelProvider {
  public name = 'lmstudio';
  private config: OpenAICompatibleConfig;

  constructor(options: LMStudioOptions = {}) {
    this.config = {
      baseUrl: (options.baseUrl ?? 'http://localhost:1234/v1').replace(/\/$/, ''),
      model: options.model ?? 'local-model',
      maxTokens: options.maxTokens,
      temperature: options.temperature
    };
  }

  public async sendPrompt(messages: ChatMessage[], tools?: ToolDefinition[], signal?: AbortSignal, options?: SendOptions): Promise<SendPromptResult> {
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
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError, tools, signal, options);
  }
}
