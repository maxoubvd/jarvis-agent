/**
 * Nettoyeur JSON multi-étapes (spec §8.2 — "Validation des Réponses JSON").
 * Les petits modèles locaux ne respectent pas toujours le format JSON strict :
 * balises <thinking>, fences Markdown, virgules traînantes, texte autour, etc.
 */

export interface JsonExtractionResult<T = unknown> {
  ok: boolean;
  value?: T;
  /** Texte hors JSON (ex: chaîne de pensée) récupéré pendant le nettoyage. */
  surroundingText?: string;
  error?: string;
}

/** Retire les blocs <thinking>...</thinking> et les renvoie séparément. */
export function stripThinking(raw: string): { text: string; thinking: string } {
  let thinking = '';
  const text = raw.replace(/<thinking>([\s\S]*?)<\/thinking>/gi, (_m, inner: string) => {
    thinking += (thinking ? '\n' : '') + inner.trim();
    return '';
  });
  return { text: text.trim(), thinking };
}

/** Retire les fences Markdown ```json ... ``` autour d'un bloc. */
function stripCodeFences(raw: string): string {
  const fenceMatch = raw.match(/```(?:json|javascript|js)?\s*\n?([\s\S]*?)```/);
  return fenceMatch ? fenceMatch[1].trim() : raw;
}

/** Trouve la première structure {...} ou [...] équilibrée dans le texte. */
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

/** Corrections courantes : virgules traînantes, guillemets typographiques. */
function repairCommonIssues(json: string): string {
  return json
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

/**
 * Extraction robuste : essaie le parse direct, puis fence Markdown,
 * puis structure équilibrée, puis réparations.
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
        // essai suivant
      }
    }
  }

  return {
    ok: false,
    surroundingText: (text + (thinking ? `\n${thinking}` : '')).trim() || undefined,
    error: 'Aucun JSON valide trouvé dans la réponse'
  };
}
