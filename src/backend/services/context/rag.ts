import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

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

interface IndexedChunk extends RagChunk {
  embedding: Float32Array;
}

function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class RagIndex {
  private chunks: IndexedChunk[] = [];
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  public get size(): number {
    return this.chunks.length;
  }

  public clear(): void {
    this.chunks = [];
  }

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        // Options can be passed here if needed
      }) as Promise<FeatureExtractionPipeline>;
    }
    return this.extractorPromise;
  }

  private async generateEmbedding(text: string): Promise<Float32Array> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return output.data as Float32Array;
  }

  public getFiles(query: string, maxResults = 50): string[] {
    const q = query.toLowerCase();
    const uniquePaths = new Set<string>();
    for (const chunk of this.chunks) {
      if (!chunk.path.startsWith('docs:') && chunk.path.toLowerCase().includes(q)) {
        uniquePaths.add(chunk.path);
        if (uniquePaths.size >= maxResults) break;
      }
    }
    return Array.from(uniquePaths);
  }

  public async addDocument(filePath: string, content: string): Promise<void> {
    this.removeDocument(filePath);

    const lines = content.split('\n');
    for (let start = 0; start < lines.length; start += CHUNK_LINES - CHUNK_OVERLAP) {
      const end = Math.min(lines.length, start + CHUNK_LINES);
      const text = lines.slice(start, end).join('\n');
      if (!text.trim()) continue;

      try {
        const embedding = await this.generateEmbedding(text);
        this.chunks.push({
          path: filePath,
          startLine: start + 1,
          endLine: end,
          text,
          embedding
        });
      } catch (err) {
        console.error(`Erreur d'embedding pour ${filePath}:`, err);
      }
      if (end >= lines.length) break;
    }
  }

  public removeDocument(filePath: string): void {
    this.removeWhere(c => c.path === filePath);
  }

  public removeByPrefix(prefix: string): void {
    this.removeWhere(c => c.path.startsWith(prefix));
  }

  private removeWhere(predicate: (chunk: RagChunk) => boolean): void {
    this.chunks = this.chunks.filter(c => !predicate(c));
  }

  public async search(query: string, topK = 5): Promise<RagSearchResult[]> {
    if (this.chunks.length === 0 || !query.trim()) return [];

    let queryEmbedding: Float32Array;
    try {
      queryEmbedding = await this.generateEmbedding(query);
    } catch {
      return [];
    }
    
    const scored: RagSearchResult[] = [];
    for (const chunk of this.chunks) {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
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
