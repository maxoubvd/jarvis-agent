<script lang="ts">
  interface Checkpoint {
    id: string;
    ref: string;
    type: string;
    description: string;
    timestamp: string;
  }

  interface Props {
    checkpoints?: Checkpoint[];
    onRollback?: (ref: string) => void;
    onRefresh?: () => void;
  }

  let { checkpoints = [], onRollback = () => {}, onRefresh = () => {} }: Props = $props();

  function typeIcon(type: string): string {
    switch (type) {
      case 'workflow': return '🟢';
      case 'action': return '🟡';
      case 'session': return '🔴';
      default: return '⚪';
    }
  }
</script>

<section class="checkpoint-panel">
  <header>
    <h2>🕒 Checkpoints (Time Travel)</h2>
    <button class="refresh" onclick={() => onRefresh()}>↻ Rafraîchir</button>
  </header>

  {#if checkpoints.length === 0}
    <div class="empty">
      Aucun checkpoint. Les checkpoints sont des <code>git stash</code> nommés créés
      avant les actions importantes.
    </div>
  {:else}
    <ul class="list">
      {#each checkpoints as cp (cp.ref)}
        <li class="item">
          <div class="info">
            <span class="desc">{typeIcon(cp.type)} {cp.description}</span>
            <span class="ref">{cp.ref} · {cp.type}</span>
          </div>
          <button class="rollback" onclick={() => onRollback(cp.ref)}>
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
    padding: 1rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.75rem;
    background: var(--vscode-editor-background);
    gap: 0.75rem;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  header h2 {
    margin: 0;
    font-size: 1rem;
  }

  .refresh {
    background: transparent;
    border: 1px solid var(--vscode-editorWidget-border);
    color: var(--vscode-editor-foreground);
    border-radius: 0.4rem;
    padding: 0.3rem 0.6rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .refresh:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .empty {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border-radius: 0.5rem;
    background: var(--vscode-editorWidget-background);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .desc {
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ref {
    font-size: 0.72rem;
    color: var(--vscode-descriptionForeground);
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .rollback {
    flex-shrink: 0;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 0.4rem;
    padding: 0.4rem 0.75rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  .rollback:hover {
    background: var(--vscode-button-hoverBackground);
  }

  code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
  }
</style>
