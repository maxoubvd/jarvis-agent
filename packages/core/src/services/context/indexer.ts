import { RagIndex, isIndexableFile, RagSearchResult } from './rag.js';
import { listDirectoryTool, readFileTool } from '../../core/mcp/tools/fileSystem.js';

const MAX_FILE_SIZE = 512 * 1024;

/**
 * Background workspace indexing (spec §5.2): walks the files allowed by the
 * sandbox/.jarvisignore and feeds the local RAG store.
 */
export class WorkspaceIndexer {
  public readonly index = new RagIndex();
  private indexing = false;
  private indexedFiles = 0;
  /** Indexing in progress, shared between concurrent callers (command palette + Settings). */
  private inFlight: Promise<number> | null = null;

  public get isIndexing(): boolean {
    return this.indexing;
  }

  public get fileCount(): number {
    return this.indexedFiles;
  }

  public async indexWorkspace(onProgress?: (indexed: number, total: number) => void): Promise<number> {
    // An indexing run was already in progress (e.g. auto-started when the sidebar
    // opened): wait for ITS result instead of immediately returning the counter still at 0.
    if (this.inFlight) return this.inFlight;

    this.indexing = true;
    this.inFlight = this.runIndexWorkspace(onProgress).finally(() => {
      this.indexing = false;
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runIndexWorkspace(onProgress?: (indexed: number, total: number) => void): Promise<number> {
    this.index.clear();
    this.indexedFiles = 0;

    const items = await listDirectoryTool('.', true);
    const files = items.filter(i => !i.isDirectory && isIndexableFile(i.path) && i.size <= MAX_FILE_SIZE);

    for (let i = 0; i < files.length; i++) {
      try {
        const content = await readFileTool(files[i].path);
        await this.index.addDocument(files[i].path, content);
        this.indexedFiles++;
      } catch {
        // unreadable or blocked file — skip and continue
      }
      onProgress?.(i + 1, files.length);
    }
    return this.indexedFiles;
  }

  /** Re-indexes a file after modification. */
  public async reindexFile(relativePath: string): Promise<void> {
    if (!isIndexableFile(relativePath)) return;
    try {
      const content = await readFileTool(relativePath);
      await this.index.addDocument(relativePath, content);
    } catch {
      this.index.removeDocument(relativePath);
    }
  }

  public async search(query: string, topK = 5): Promise<RagSearchResult[]> {
    return this.index.search(query, topK);
  }

  /** Search by file name for @ autocompletion */
  public searchFiles(query: string, maxResults = 50): string[] {
    return this.index.getFiles(query, maxResults);
  }

  /** Search restricted to Markdown documentation (@docs mentions). */
  public async searchDocs(query: string, topK = 5): Promise<RagSearchResult[]> {
    const results = await this.index.search(query, topK * 3);
    return results.filter(r => r.path.endsWith('.md')).slice(0, topK);
  }
}
