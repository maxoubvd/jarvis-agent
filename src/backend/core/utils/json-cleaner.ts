/**
 * Multi-step JSON cleaner (spec §8.2 — "JSON Response Validation").
 * Small local models don't always respect strict JSON format:
 * <thinking> tags, Markdown fences, trailing commas, surrounding text, etc.
 */

export interface JsonExtractionResult<T = unknown> {
  ok: boolean;
  value?: T;
  /** Non-JSON surrounding text (e.g. chain-of-thought) recovered during cleanup. */
  surroundingText?: string;
  error?: string;
}

/** Strips <thinking>...</thinking> blocks and returns them separately. */
export function stripThinking(raw: string): { text: string; thinking: string } {
  let thinking = '';
  const text = raw.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_m, inner: string) => {
    thinking += (thinking ? '\n' : '') + inner.trim();
    return '';
  });
  return { text: text.trim(), thinking };
}

/** Strips Markdown ```json ... ``` fences around a block. */
function stripCodeFences(raw: string): string {
  const fenceMatch = raw.match(/```(?:json|javascript|js)?\s*\n?([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : raw;
}

/** Finds the first balanced {...} or [...] structure in the text. */
export function findBalancedJson(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    const open = text[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          return text.slice(i, j + 1);
        }
      }
    }
  }
  return null;
}

/** Common fixes: trailing commas, typographic quotes. */
function repairCommonIssues(json: string): string {
  return json
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

/**
 * Robust extraction: tries direct parse, then Markdown fence,
 * then balanced structure, then repairs.
 */
export function extractJson<T = unknown>(raw: string): JsonExtractionResult<T> {
  const { text, thinking } = stripThinking(raw);

  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  const unfenced = stripCodeFences(trimmed);
  if (unfenced !== trimmed) candidates.push(unfenced);

  const balanced = findBalancedJson(unfenced);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    for (const attempt of [candidate, repairCommonIssues(candidate)]) {
      try {
        const value = JSON.parse(attempt) as T;
        if (value !== null && typeof value === 'object') {
          const surrounding = balanced
            ? (unfenced.replace(balanced, '').trim() + (thinking ? `\n${thinking}` : '')).trim()
            : thinking;
          return { ok: true, value, surroundingText: surrounding || undefined };
        }
      } catch {
        // next attempt
      }
    }
  }

  return {
    ok: false,
    surroundingText: (text + (thinking ? `\n${thinking}` : '')).trim() || undefined,
    error: 'No valid JSON found in the response'
  };
}
