import { ChatMessage, NativeToolCall, SendPromptResult, SendOptions, ProviderUsage } from '../abstract.js';
import { ToolDefinition } from '../../core/agent/tool-registry.js';

export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Limite de tokens de complétion (`max_tokens`), omise si non configurée. */
  maxTokens?: number;
  /** Température d'échantillonnage, omise si non configurée (défaut de l'API). */
  temperature?: number;
  extraHeaders?: Record<string, string>;
}

/** Forme brute du bloc `usage` OpenAI/DeepSeek (champs de cache selon le provider). */
interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  /** DeepSeek expose le cache via ces deux champs plats. */
  prompt_cache_hit_tokens?: number;
}

/** Normalise le bloc `usage` (OpenAI: `prompt_tokens_details.cached_tokens`, DeepSeek: `prompt_cache_hit_tokens`). */
function extractUsage(usage: RawUsage | undefined): ProviderUsage | undefined {
  if (!usage) return undefined;
  const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    cachedTokens
  };
}

/** Corps commun aux deux modes ; `response_format` n'est ajouté que sur demande explicite. */
function buildBody(
  config: OpenAICompatibleConfig,
  messages: ChatMessage[],
  oaiTools: ReturnType<typeof buildOpenAITools>,
  stream: boolean,
  options?: SendOptions
): Record<string, unknown> {
  return {
    model: config.model,
    messages: messages.map(m => {
      const msg: any = { role: m.role, content: m.content || '' };
      if (m.tool_calls) msg.tool_calls = m.tool_calls;
      if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
      return msg;
    }),
    ...(oaiTools ? { tools: oaiTools } : {}),
    ...(config.maxTokens ? { max_tokens: config.maxTokens } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(options?.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    // Nécessaire pour que l'API émette `usage` (donc les cached_tokens) en streaming.
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : { stream: false })
  };
}

/**
 * Shared logic for any OpenAI-compatible chat completions endpoint
 * (OpenRouter, LM Studio, OpenAI, etc.).
 */
export async function openaiCompatibleSend(
  config: OpenAICompatibleConfig,
  messages: ChatMessage[],
  tools?: ToolDefinition[],
  signal?: AbortSignal,
  options?: SendOptions
): Promise<SendPromptResult> {
  const oaiTools = buildOpenAITools(tools);
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    signal,
    body: JSON.stringify(buildBody(config, messages, oaiTools, false, options))
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: NativeToolCall[] } }>;
    usage?: RawUsage;
  };
  const choiceMsg = data.choices?.[0]?.message;
  return {
    text: choiceMsg?.content ?? '',
    toolCalls: choiceMsg?.tool_calls,
    usage: extractUsage(data.usage)
  };
}

export async function openaiCompatibleStream(
  config: OpenAICompatibleConfig,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: (toolCalls?: NativeToolCall[], usage?: ProviderUsage) => void,
  onError: (err: Error) => void,
  tools?: ToolDefinition[],
  signal?: AbortSignal,
  options?: SendOptions
): Promise<void> {
  try {
    const oaiTools = buildOpenAITools(tools);
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      signal,
      body: JSON.stringify(buildBody(config, messages, oaiTools, true, options))
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

    let accumulatedToolCalls: NativeToolCall[] = [];
    let usage: ProviderUsage | undefined;

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
          onDone(accumulatedToolCalls.length > 0 ? accumulatedToolCalls.filter(Boolean) : undefined, usage);
          return;
        }

        try {
          const parsed = JSON.parse(payload) as any;
          // Avec `include_usage`, l'API émet un chunk final `choices: []` + `usage`.
          if (parsed.usage) usage = extractUsage(parsed.usage);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) onChunk(delta.content);

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!accumulatedToolCalls[idx]) {
                accumulatedToolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: tc.function?.name || '', arguments: '' } };
              }
              if (tc.function?.arguments) {
                accumulatedToolCalls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        } catch {
          // Skip malformed SSE line
        }
      }
    }

    onDone(accumulatedToolCalls.length > 0 ? accumulatedToolCalls.filter(Boolean) : undefined, usage);
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

function buildOpenAITools(tools?: ToolDefinition[]) {
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
