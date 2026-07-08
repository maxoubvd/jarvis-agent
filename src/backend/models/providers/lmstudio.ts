import { IModelProvider, ChatMessage } from '../abstract.js';
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

  public async sendPrompt(messages: ChatMessage[]): Promise<string> {
    return openaiCompatibleSend(this.config, messages);
  }

  public async sendPromptStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ): Promise<void> {
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError);
  }
}
