<script lang="ts">
  import type { PendingFileChange } from '../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    files?: PendingFileChange[];
    onResolveHunk?: (path: string, hunkId: number, revision: number, action: 'accept' | 'reject') => void;
    onResolveFile?: (path: string, action: 'accept' | 'reject') => void;
    onResolveAll?: (action: 'accept' | 'reject') => void;
  }

  let {
    files = [],
    onResolveHunk = () => {},
    onResolveFile = () => {},
    onResolveAll = () => {}
  }: Props = $props();

  const totalHunks = $derived(files.reduce((sum, f) => sum + f.hunks.length, 0));
</script>

{#if files.length > 0}
  <section class="review" aria-label="AI changes to review">
    <div class="review-head">
      <span class="review-title">
        <Icon name="tools" size={13} />
        AI changes to review — {totalHunks} change{totalHunks === 1 ? '' : 's'} in {files.length}
        file{files.length === 1 ? '' : 's'}
      </span>
      <div class="review-actions">
        <button class="j-btn j-btn-primary" onclick={() => onResolveAll('accept')}>
          <Icon name="check" size={13} /> Accept all
        </button>
        <button class="j-btn j-btn-danger" onclick={() => onResolveAll('reject')}>
          Reject all
        </button>
      </div>
    </div>

    {#each files as file (file.path)}
      <div class="file">
        <div class="file-head">
          <code class="file-path">{file.path}</code>
          {#if file.isNew}<span class="badge-new">new file</span>{/if}
          <span class="spacer"></span>
          <button class="j-btn" onclick={() => onResolveFile(file.path, 'accept')}>
            <Icon name="check" size={12} /> Accept file
          </button>
          <button class="j-btn j-btn-danger" onclick={() => onResolveFile(file.path, 'reject')}>
            Reject file
          </button>
        </div>

        {#each file.hunks as hunk (hunk.id)}
          <div class="hunk">
            <div class="hunk-head">
              <code class="hunk-pos">@@ -{hunk.beforeStart} +{hunk.afterStart} @@</code>
              <span class="spacer"></span>
              <button
                class="j-btn hunk-btn"
                title="Keep this change"
                onclick={() => onResolveHunk(file.path, hunk.id, file.revision, 'accept')}
              >
                <Icon name="check" size={12} /> Accept
              </button>
              <button
                class="j-btn j-btn-danger hunk-btn"
                title="Undo this change in the file"
                onclick={() => onResolveHunk(file.path, hunk.id, file.revision, 'reject')}
              >
                Reject
              </button>
            </div>
            <pre class="diff">{#each hunk.contextBefore as line, i (i)}<span class="ln ctx">  {line}
</span>{/each}{#each hunk.beforeLines as line, i (i)}<span class="ln del">- {line}
</span>{/each}{#each hunk.afterLines as line, i (i)}<span class="ln add">+ {line}
</span>{/each}{#each hunk.contextAfter as line, i (i)}<span class="ln ctx">  {line}
</span>{/each}</pre>
          </div>
        {/each}
      </div>
    {/each}
  </section>
{/if}

<style>
  .review {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-2);
    padding: var(--jarvis-space-3);
    border: 1px solid var(--vscode-editorWidget-border);
    border-left: 3px solid var(--jarvis-accent);
    border-radius: var(--jarvis-radius-md);
    background: var(--vscode-editorWidget-background);
    max-height: 30vh;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .review-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--jarvis-space-2);
  }

  .review-title {
    display: inline-flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    font-weight: 600;
    font-size: var(--jarvis-text-sm);
  }

  .review-actions {
    display: flex;
    gap: var(--jarvis-space-2);
  }

  .file {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-1);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-sm);
    padding: var(--jarvis-space-2);
    background: var(--vscode-editor-background);
  }

  .file-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--jarvis-space-2);
  }

  .file-path {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--jarvis-text-sm);
    font-weight: 600;
    word-break: break-all;
  }

  .badge-new {
    font-size: var(--jarvis-text-xs);
    padding: 1px 6px;
    border-radius: var(--jarvis-radius-pill);
    background: var(--jarvis-gold-dim);
    color: var(--jarvis-gold);
  }

  .spacer {
    flex: 1;
  }

  .hunk {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hunk-head {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-2);
  }

  .hunk-pos {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-descriptionForeground);
  }

  .hunk-btn {
    padding: 2px 8px;
    font-size: var(--jarvis-text-xs);
  }

  .diff {
    margin: 0;
    padding: var(--jarvis-space-1) 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--jarvis-text-xs);
    line-height: 1.45;
    overflow-x: auto;
    border-radius: var(--jarvis-radius-sm);
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.08));
  }

  .ln {
    display: block;
    padding: 0 var(--jarvis-space-2);
    white-space: pre;
  }

  .ln.ctx {
    color: var(--vscode-descriptionForeground);
  }

  .ln.del {
    background: var(--vscode-diffEditor-removedTextBackground, rgba(255, 80, 80, 0.2));
  }

  .ln.add {
    background: var(--vscode-diffEditor-insertedTextBackground, rgba(80, 200, 120, 0.2));
  }
</style>
