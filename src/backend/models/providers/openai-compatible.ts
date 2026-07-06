import { ChatMessage } from '../abstract.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Limite de tokens de complétion (`max_tokens`), omise si non configurée. */
  maxTokens?: number;
  extraHeaders?: Record<string, string>;
}

/**
 * Shared logic for any OpenAI-compatible chat completions endpoint
 * (OpenRouter, LM Studio, OpenAI, etc.).
 */
export async function openaiCompatibleSend(
  config: OpenAICompatibleConfig,
  messages: ChatMessage[]
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
      stream: false
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

export async function openaiCompatibleStream(
  config: OpenAICompatibleConfig,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (err: Error) => void
): Promise<void> {
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error('Réponse sans corps de flux');
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
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') {
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onChunk(content);
        } catch {
          // Skip malformed SSE line
        }
      }
    }

    onDone();
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

function buildHeaders(config: OpenAICompatibleConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.extraHeaders
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  return headers;
}
