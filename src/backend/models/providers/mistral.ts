import { IModelProvider, ChatMessage } from '../abstract.js';
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

  public async sendPrompt(messages: ChatMessage[]): Promise<string> {
    if (!this.config.apiKey) {
      throw new Error('Mistral: clé API manquante dans jarvis-config.json');
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
      onError(new Error('Mistral: clé API manquante dans jarvis-config.json'));
      return;
    }
    return openaiCompatibleStream(this.config, messages, onChunk, onDone, onError);
  }
}
