import { RagSearchResult, formatSearchResults } from './rag.js';

export interface MentionDeps {
  readFile(path: string): Promise<string>;
  /** RAG search limited to documentation (.md files). */
  searchDocs?(query: string): Promise<RagSearchResult[]>;
}

export interface ExpandedPrompt {
  /** Prompt with the mention context injected. */
  expanded: string;
  /** Resolved mentions, for displaying badges in the UI. */
  mentions: Array<{ kind: 'file' | 'docs'; value: string; ok: boolean }>;
}

// Path/query with spaces allowed via the quoted form: @file:"my folder/file.md", @docs:"my query"
const FILE_MENTION = /@file:(?:"([^"]+)"|(\S+))/g;
const DOCS_MENTION = /@docs:(?:"([^"]+)"|(\S+))/g;

/**
 * Expansion of `@file:<path>` and `@docs:<query>` mentions (spec Phase 4):
 * the referenced content is appended to the prompt as context.
 */
export async function expandMentions(text: string, deps: MentionDeps): Promise<ExpandedPrompt> {
  const mentions: ExpandedPrompt['mentions'] = [];
  const contextParts: string[] = [];

  for (const match of [...text.matchAll(FILE_MENTION)]) {
    const filePath = match[1] ?? match[2];
    try {
      const content = await deps.readFile(filePath);
      contextParts.push(`Content of ${filePath}:\n\`\`\`\n${content}\n\`\`\``);
      mentions.push({ kind: 'file', value: filePath, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      contextParts.push(`(Unable to read ${filePath}: ${msg})`);
      mentions.push({ kind: 'file', value: filePath, ok: false });
    }
  }

  for (const match of [...text.matchAll(DOCS_MENTION)]) {
    const query = (match[1] ?? match[2]).replace(/[-_]/g, ' ');
    const results = (await deps.searchDocs?.(query)) ?? [];
    if (results.length > 0) {
      const snippets = formatSearchResults(results.slice(0, 3));
      contextParts.push(`Relevant documentation for "${query}":\n${snippets}`);
      mentions.push({ kind: 'docs', value: query, ok: true });
    } else {
      mentions.push({ kind: 'docs', value: query, ok: false });
    }
  }

  if (contextParts.length === 0) {
    return { expanded: text, mentions };
  }

  const cleaned = text.replace(FILE_MENTION, '$1$2').replace(DOCS_MENTION, '$1$2');
  return {
    expanded: `${cleaned}\n\n--- CONTEXT ---\n${contextParts.join('\n\n')}`,
    mentions
  };
}
