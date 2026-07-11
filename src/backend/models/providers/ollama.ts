import { IModelProvider, ChatMessage, SendPromptResult, NativeToolCall, SendOptions, ProviderUsage } from '../abstract.js';
import { ToolDefinition } from '../../core/agent/tool-registry.js';

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

  public async sendPrompt(messages: ChatMessage[], tools?: ToolDefinition[], signal?: AbortSignal, options?: SendOptions): Promise<SendPromptResult> {
    const oaiTools = this.buildOllamaTools(tools);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => {
          const msg: any = { role: m.role, content: m.content || '' };
          if (m.tool_calls) msg.tool_calls = m.tool_calls;
          return msg;
        }),
        ...(oaiTools ? { tools: oaiTools } : {}),
        ...(options?.responseFormat === 'json_object' ? { format: 'json' } : {}),
        ...this.completionOptions(),
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { message?: { content?: string; tool_calls?: NativeToolCall[] } };
    return {
      text: data.message?.content ?? '',
      toolCalls: data.message?.tool_calls
    };
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
    try {
      const oaiTools = this.buildOllamaTools(tools);
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model: this.model,
          messages: messages.map(m => {
            const msg: any = { role: m.role, content: m.content || '' };
            if (m.tool_calls) msg.tool_calls = m.tool_calls;
            return msg;
          }),
          ...(oaiTools ? { tools: oaiTools } : {}),
          ...(options?.responseFormat === 'json_object' ? { format: 'json' } : {}),
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

      const accumulatedToolCalls: NativeToolCall[] = [];

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
            const parsed = JSON.parse(trimmed) as { message?: { content?: string; tool_calls?: NativeToolCall[] }; done?: boolean };
            const content = parsed.message?.content;
            if (content) onChunk(content);
            if (parsed.message?.tool_calls) {
              for (const tc of parsed.message.tool_calls) {
                accumulatedToolCalls.push(tc);
              }
            }
            if (parsed.done) {
              onDone(accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined);
              return;
            }
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

  private buildOllamaTools(tools?: ToolDefinition[]) {
    if (!tools || tools.length === 0) return undefined;
    return tools.map(t => {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const p of t.parameters) {
        if (p.jsonSchema) {
          properties[p.name] = p.jsonSchema;
        } else {
          properties[p.name] = { type: p.type, description: p.description };
        }
        if (p.required) required.push(p.name);
      }
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties,
            required
          }
        }
      };
    });
  }
}
