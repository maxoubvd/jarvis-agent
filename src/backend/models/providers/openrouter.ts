import { IModelProvider, ChatMessage } from '../abstract.js';
import { openaiCompatibleSend, openaiCompatibleStream, OpenAICompatibleConfig } from './openai-compatible.js';

export interface OpenRouterOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export class OpenRouterProvider implements IModelProvider {
  public name = 'openrouter';
  private config: OpenAICompatibleConfig;

  constructor(options: OpenRouterOptions = {}) {
    this.config = {
      baseUrl: (options.baseUrl ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      model: options.model ?? 'deepseek-coder-v3',
      apiKey: options.apiKey,
      extraHeaders: {
        'HTTP-Referer': 'https://github.com/jarvis-agent',
        'X-Title': 'Jarvis Agent'
      }
    };
  }

  public async sendPrompt(messages: ChatMessage[]): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('OpenRouter: clé API manquante dans jarvis-config.json');
    }
    return openaiCompatibleSend(this.config, messages);
  }

  public async sendPromptStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ): Promise<void> {
    if (!this.config.apiKey) {
      onError(new Error('OpenRouter: clé API manquante dans jarvis-config.json'));
      return;
    }
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError);
  }
}
