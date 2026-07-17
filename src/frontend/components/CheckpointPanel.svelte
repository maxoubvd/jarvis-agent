<script lang="ts">
  import Icon from './Icon.svelte';

  interface Checkpoint {
    id: string;
    ref: string;
    type: string;
    description: string;
    timestamp: string;
  }

  interface Props {
    checkpoints?: Checkpoint[];
    onRollback?: (id: string) => void;
    onRefresh?: () => void;
  }

  let { checkpoints = [], onRollback = () => {}, onRefresh = () => {} }: Props = $props();
</script>

<section class="checkpoint-panel">
  <header>
    <h2><Icon name="history" size={15} /> Checkpoints</h2>
    <button class="refresh" onclick={() => onRefresh()}>
      <Icon name="sync" size={13} /> Refresh
    </button>
  </header>

  {#if checkpoints.length === 0}
    <div class="empty">
      No checkpoints yet. Checkpoints are named <code>git stash</code> entries created
      before important actions.
    </div>
  {:else}
    <ul class="list">
      {#each checkpoints as cp (cp.id)}
        <li class="item">
          <div class="info">
            <span class="desc"><span class="dot {cp.type}"></span>{cp.description}</span>
            <span class="ref">{cp.ref} · {cp.type}</span>
          </div>
          <button class="rollback" onclick={() => onRollback(cp.id)}>
            Rollback
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .checkpoint-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--jarvis-space-4);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-lg);
    background: var(--vscode-editor-background);
    gap: var(--jarvis-space-3);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--jarvis-space-2);
    flex-wrap: wrap;
  }

  header h2 {
    margin: 0;
    font-size: var(--jarvis-text-md);
    font-weight: 600;
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-1);
  }

  .refresh {
    display: inline-flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    background: transparent;
    border: 1px solid var(--vscode-editorWidget-border);
    color: var(--vscode-editor-foreground);
    border-radius: var(--jarvis-radius-pill);
    padding: 4px 10px;
    font-size: var(--jarvis-text-sm);
    cursor: pointer;
    transition: background var(--jarvis-transition);
  }

  .refresh:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .empty {
    color: var(--vscode-descriptionForeground);
    font-size: var(--jarvis-text-md);
    line-height: 1.5;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-2);
  }

  .item {
    display: flex;
    flex-wrap: wrap;
    row-gap: var(--jarvis-space-1);
    align-items: center;
    justify-content: space-between;
    gap: var(--jarvis-space-2);
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    border-radius: var(--jarvis-radius-md);
    border: 1px solid var(--vscode-editorWidget-border);
    background: var(--vscode-editorWidget-background);
  }

  .info {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: 2px;
    min-width: 0;
  }

  .desc {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    font-size: var(--jarvis-text-md);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: var(--jarvis-radius-pill);
    background: var(--vscode-descriptionForeground);
  }

  .dot.workflow {
    background: var(--vscode-terminal-ansiGreen);
  }

  .dot.action {
    background: var(--jarvis-gold);
  }

  .dot.session {
    background: var(--jarvis-accent);
  }

  .ref {
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rollback {
    flex-shrink: 0;
    margin-left: auto;
    background: var(--jarvis-accent);
    color: var(--jarvis-accent-fg);
    border: none;
    border-radius: var(--jarvis-radius-pill);
    padding: 5px 12px;
    font-size: var(--jarvis-text-sm);
    cursor: pointer;
    transition: background var(--jarvis-transition);
  }

  .rollback:hover {
    background: var(--jarvis-accent-hover);
  }

  code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
  }
</style>
