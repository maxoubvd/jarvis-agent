/**
 * Base vectorielle locale légère (RAG, spec §5.2 / Phase 4) :
 * indexation TF-IDF par chunks + recherche par similarité cosinus.
 * Zéro dépendance externe, tout reste en mémoire locale.
 */

export interface RagChunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface RagSearchResult {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
}

const CHUNK_LINES = 40;
const CHUNK_OVERLAP = 8;

function tokenize(text: string): string[] {
  return (
    text
      // découpe camelCase pour matcher les identifiants de code (avant le lowercase)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .match(/[a-zà-ÿ0-9_]{2,}/gi) ?? []
  ).map(t => t.toLowerCase());
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

interface IndexedChunk extends RagChunk {
  tf: Map<string, number>;
  norm: number;
}

export class RagIndex {
  private chunks: IndexedChunk[] = [];
  private documentFrequency = new Map<string, number>();

  public get size(): number {
    return this.chunks.length;
  }

  public clear(): void {
    this.chunks = [];
    this.documentFrequency = new Map();
  }

  /** Découpe un fichier en chunks avec chevauchement et les indexe. */
  public addDocument(filePath: string, content: string): void {
    // Ré-indexation d'un fichier : retirer ses anciens chunks
    this.removeDocument(filePath);

    const lines = content.split('\n');
    for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
      const end = Math.min(lines.length, start + CHUNK_LINES);
      const text = lines.slice(start, end).join('\n');
      if (!text.trim()) continue;

      const tf = termFrequencies(tokenize(text));
      this.chunks.push({
        path: filePath,
        startLine: start + 1,
        endLine: end,
        text,
        tf,
        norm: 0
      });
      for (const term of tf.keys()) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      if (end >= lines.length) break;
    }
  }

  public removeDocument(filePath: string): void {
    this.removeWhere(c => c.path === filePath);
  }

  /** Retire tous les documents dont le path commence par `prefix` (ex: `docs:<id>:`). */
  public removeByPrefix(prefix: string): void {
    this.removeWhere(c => c.path.startsWith(prefix));
  }

  private removeWhere(predicate: (chunk: RagChunk) => boolean): void {
    const removed = this.chunks.filter(predicate);
    if (removed.length === 0) return;
    for (const chunk of removed) {
      for (const term of chunk.tf.keys()) {
        const df = (this.documentFrequency.get(term) ?? 1) - 1;
        if (df <= 0) this.documentFrequency.delete(term);
        else this.documentFrequency.set(term, df);
      }
    }
    const removedSet = new Set(removed);
    this.chunks = this.chunks.filter(c => !removedSet.has(c as IndexedChunk));
  }

  private idf(term: string): number {
    const df = this.documentFrequency.get(term) ?? 0;
    if (df === 0) return 0;
    return Math.log(1 + this.chunks.length / df);
  }

  /** Recherche sémantique lexicale : cosinus TF-IDF requête vs chunks. */
  public search(query: string, topK = 5): RagSearchResult[] {
    const queryTf = termFrequencies(tokenize(query));
    if (queryTf.size === 0 || this.chunks.length === 0) return [];

    const queryWeights = new Map<string, number>();
    let queryNorm = 0;
    for (const [term, tf] of queryTf) {
      const w = tf * this.idf(term);
      queryWeights.set(term, w);
      queryNorm += w * w;
    }
    queryNorm = Math.sqrt(queryNorm);
    if (queryNorm === 0) return [];

    const scored: RagSearchResult[] = [];
    for (const chunk of this.chunks) {
      let dot = 0;
      let chunkNorm = 0;
      for (const [term, tf] of chunk.tf) {
        const w = tf * this.idf(term);
        chunkNorm += w * w;
        const qw = queryWeights.get(term);
        if (qw) dot += qw * w;
      }
      if (dot === 0) continue;
      const score = dot / (queryNorm * Math.sqrt(chunkNorm));
      scored.push({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        snippet: chunk.text.length > 600 ? chunk.text.slice(0, 600) + '…' : chunk.text,
        score
      });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

const INDEXABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.svelte', '.py', '.java', '.go', '.rs',
  '.cpp', '.c', '.h', '.cs', '.php', '.rb', '.md', '.json', '.css', '.html', '.vue'
]);

export function isIndexableFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return INDEXABLE_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
