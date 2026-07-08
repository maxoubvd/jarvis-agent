import { IModelProvider, ChatMessage, SendPromptResult, NativeToolCall, SendOptions, ProviderUsage } from '../abstract.js';
import { ToolDefinition } from '../../core/agent/tool-registry.js';
import { openaiCompatibleSend, openaiCompatibleStream, OpenAICompatibleConfig } from './openai-compatible.js';

export interface OpenRouterOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

export class OpenRouterProvider implements IModelProvider {
  public name = 'openrouter';
  private config: OpenAICompatibleConfig;

  constructor(options: OpenRouterOptions = {}) {
    this.config = {
      baseUrl: (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      model: options.model ?? 'deepseek-coder-v3',
      apiKey: options.apiKey,
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      extraHeaders: {
        'HTTP-Referer': 'https://github.com/jarvis-agent',
        'X-Title': 'Jarvis Agent'
      }
    };
  }

  public async sendPrompt(messages: ChatMessage[], tools?: ToolDefinition[], signal?: AbortSignal, options?: SendOptions): Promise<SendPromptResult> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter: clé API manquante dans jarvis-config.json');
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
      onError(new Error('OpenRouter: clé API manquante dans jarvis-config.json'));
      return;
    }
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError, tools, signal, options);
  }
}
