import type { ChatMessage } from '../../models/abstract.js';

/**
 * Construit le prompt d'autocomplétion inline (Tab / ghost text) : un seul appel
 * non-agentique, contexte volontairement réduit (préfixe/suffixe locaux, pas de RAG)
 * pour rester compatible avec la latence attendue d'une complétion à chaque frappe.
 */
export function buildCompletionPrompt(prefix: string, suffix: string, languageId: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        `Tu es un moteur d'autocomplétion de code (langage: ${languageId}). ` +
        'Réponds UNIQUEMENT avec le texte à insérer à la position <CURSOR>, sans aucune explication, ' +
        "sans balises markdown/```, sans répéter le préfixe ou le suffixe. " +
        'Si aucune complétion pertinente ne vient, réponds avec une chaîne vide.'
    },
    { role: 'user', content: `${prefix}<CURSOR>${suffix}` }
  ];
}

/** Nettoie la réponse brute du modèle (retire d'éventuelles balises markdown/fences). */
export function extractCompletionText(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  // Un modèle qui hallucine le marqueur ne doit pas le réinjecter dans l'éditeur.
  text = text.replace(/<CURSOR>/g, '');
  return text;
}
