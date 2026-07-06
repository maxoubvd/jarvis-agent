import { RagIndex, isIndexableFile, RagSearchResult } from './rag.js';
import { listDirectoryTool, readFileTool } from '../../core/mcp/tools/fileSystem.js';

const MAX_FILE_SIZE = 512 * 1024;

/**
 * Indexation du workspace en arrière-plan (spec §5.2) : parcourt les fichiers
 * autorisés par le sandbox/.jarvisignore et alimente la base RAG locale.
 */
export class WorkspaceIndexer {
  public readonly index = new RagIndex();
  private indexing = false;
  private indexedFiles = 0;

  public get isIndexing(): boolean {
    return this.indexing;
  }

  public get fileCount(): number {
    return this.indexedFiles;
  }

  public async indexWorkspace(onProgress?: (indexed: number, total: number) => void): Promise<number> {
    if (this.indexing) return this.indexedFiles;
    this.indexing = true;
    try {
      this.index.clear();
      this.indexedFiles = 0;

      const items = await listDirectoryTool('.', true);
      const files = items.filter(i => !i.isDirectory && isIndexableFile(i.path) && i.size <= MAX_FILE_SIZE);

      for (let i = 0; i < files.length; i++) {
        try {
          const content = await readFileTool(files[i].path);
          this.index.addDocument(files[i].path, content);
          this.indexedFiles++;
        } catch {
          // fichier illisible ou bloqué — on continue
        }
        onProgress?.(i + 1, files.length);
      }
      return this.indexedFiles;
    } finally {
      this.indexing = false;
    }
  }

  /** Ré-indexe un fichier après modification. */
  public async reindexFile(relativePath: string): Promise<void> {
    if (!isIndexableFile(relativePath)) return;
    try {
      const content = await readFileTool(relativePath);
      this.index.addDocument(relativePath, content);
    } catch {
      this.index.removeDocument(relativePath);
    }
  }

  public search(query: string, topK = 5): RagSearchResult[] {
    return this.index.search(query, topK);
  }

  /** Recherche restreinte à la documentation Markdown (mentions @docs). */
  public searchDocs(query: string, topK = 5): RagSearchResult[] {
    return this.index.search(query, topK * 3).filter(r => r.path.endsWith('.md')).slice(0, topK);
  }
}
