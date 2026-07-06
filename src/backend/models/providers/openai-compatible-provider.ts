import { IModelProvider, ChatMessage } from '../abstract.js';
import { openaiCompatibleSend, openaiCompatibleStream, OpenAICompatibleConfig } from './openai-compatible.js';

export interface OpenAICompatibleProviderOptions {
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  maxTokens?: number;
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
      extraHeaders: options.extraHeaders
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
