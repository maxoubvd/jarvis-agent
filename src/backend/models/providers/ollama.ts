import { IModelProvider, ChatMessage } from '../abstract.js';

export interface OllamaOptions {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Limite de tokens de complétion (`options.num_predict`), omise si non configurée. */
  maxTokens?: number;
  /** Température d'échantillonnage (`options.temperature`), omise si non configurée. */
  temperature?: number;
}

export class OllamaProvider implements IModelProvider {
  public name = 'ollama';
  private baseUrl: string;
  private model: string;
  private maxTokens?: number;
  private temperature?: number;

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = options.model ?? 'qwen2.5-coder:7b';
    this.maxTokens = options.maxTokens;
    this.temperature = options.temperature;
  }

  private completionOptions(): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    if (this.maxTokens) options.num_predict = this.maxTokens;
    if (this.temperature !== undefined) options.temperature = this.temperature;
    return Object.keys(options).length > 0 ? { options } : {};
  }

  public async sendPrompt(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...this.completionOptions(),
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }

  public async sendPromptStream(
    messages: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: () => void,
    onError: (err: Error) => void
  ): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
          ...this.completionOptions(),
          stream: true
        })
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
      }
      if (!response.body) {
        throw new Error('Ollama: réponse sans corps de flux');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed) as {
              message?: { content?: string };
              done?: boolean;
            };
            const content = parsed.message?.content;
            if (content) onChunk(content);
          } catch {
            // Skip malformed NDJSON line
          }
        }
      }

      onDone();
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}
