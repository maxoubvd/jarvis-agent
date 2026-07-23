import type { ChatMessage } from '../../models/abstract.js';

/**
 * Builds the inline autocompletion prompt (Tab / ghost text): a single
 * non-agentic call, with deliberately reduced context (local prefix/suffix,
 * no RAG) to stay within the latency expected of a completion on every keystroke.
 */
export function buildCompletionPrompt(prefix: string, suffix: string, languageId: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        `You are a code autocompletion engine (language: ${languageId}). ` +
        'Reply ONLY with the text to insert at the <CURSOR> position, with no explanation, ' +
        "no markdown/``` fences, and without repeating the prefix or suffix. " +
        'If no relevant completion comes to mind, reply with an empty string.'
    },
    { role: 'user', content: `${prefix}<CURSOR>${suffix}` }
  ];
}

/** Cleans the model's raw response (strips any markdown/fence markers). */
export function extractCompletionText(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  // A model that hallucinates the marker must not have it re-injected into the editor.
  text = text.replace(/<CURSOR>/g, '');
  return text;
}
