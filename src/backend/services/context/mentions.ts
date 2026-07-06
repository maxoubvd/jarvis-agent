import { RagSearchResult } from './rag.js';

export interface MentionDeps {
  readFile(path: string): Promise<string>;
  /** Recherche RAG limitée à la documentation (fichiers .md). */
  searchDocs?(query: string): RagSearchResult[];
}

export interface ExpandedPrompt {
  /** Prompt avec le contexte des mentions injecté. */
  expanded: string;
  /** Mentions résolues, pour affichage de badges dans l'UI. */
  mentions: Array<{ kind: 'file' | 'docs'; value: string; ok: boolean }>;
}

const FILE_MENTION = /@file:(\S+)/g;
const DOCS_MENTION = /@docs:(\S+)/g;

/**
 * Expansion des mentions `@file:<chemin>` et `@docs:<requête>` (spec Phase 4) :
 * le contenu référencé est ajouté au prompt comme contexte.
 */
export async function expandMentions(text: string, deps: MentionDeps): Promise<ExpandedPrompt> {
  const mentions: ExpandedPrompt['mentions'] = [];
  const contextParts: string[] = [];

  for (const match of [...text.matchAll(FILE_MENTION)]) {
    const filePath = match[1];
    try {
      const content = await deps.readFile(filePath);
      contextParts.push(`Contenu de ${filePath}:\n\`\`\`\n${content}\n\`\`\``);
      mentions.push({ kind: 'file', value: filePath, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      contextParts.push(`(Impossible de lire ${filePath}: ${msg})`);
      mentions.push({ kind: 'file', value: filePath, ok: false });
    }
  }

  for (const match of [...text.matchAll(DOCS_MENTION)]) {
    const query = match[1].replace(/[-_]/g, ' ');
    const results = deps.searchDocs?.(query) ?? [];
    if (results.length > 0) {
      const snippets = results
        .slice(0, 3)
        .map(r => `— ${r.path} (lignes ${r.startLine}-${r.endLine}):\n${r.snippet}`)
        .join('\n\n');
      contextParts.push(`Documentation pertinente pour "${query}":\n${snippets}`);
      mentions.push({ kind: 'docs', value: query, ok: true });
    } else {
      mentions.push({ kind: 'docs', value: query, ok: false });
    }
  }

  if (contextParts.length === 0) {
    return { expanded: text, mentions };
  }

  const cleaned = text.replace(FILE_MENTION, '$1').replace(DOCS_MENTION, '$1');
  return {
    expanded: `${cleaned}\n\n--- CONTEXTE ---\n${contextParts.join('\n\n')}`,
    mentions
  };
}
