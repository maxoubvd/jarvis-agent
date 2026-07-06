<script lang="ts">
  import type { AnalyticsStats } from '../shared/types';

  interface Props {
    stats?: AnalyticsStats | null;
    onRefresh?: () => void;
    onExport?: () => void;
  }

  let { stats = null, onRefresh = () => {}, onExport = () => {} }: Props = $props();

  const successRate = $derived(
    stats && stats.summary.totalActions > 0
      ? Math.round((stats.summary.successCount / stats.summary.totalActions) * 100)
      : 0
  );

  const modelEntries = $derived(stats ? Object.entries(stats.models) : []);
  const maxModelTokens = $derived(Math.max(1, ...modelEntries.map(([, m]) => m.tokensUsed)));
  const typeEntries = $derived(stats ? Object.entries(stats.actionsByType) : []);

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }
</script>

<section class="analytics-panel">
  <header>
    <h2>📊 Analytics</h2>
    <div class="actions">
      <button onclick={onRefresh}>🔄 Refresh</button>
      <button onclick={onExport}>📤 Export</button>
    </div>
  </header>

  {#if !stats}
    <div class="empty">No data yet.</div>
  {:else}
    <div class="tiles">
      <div class="tile">
        <div class="tile-value">{stats.summary.totalActions}</div>
        <div class="tile-label">Actions</div>
      </div>
      <div class="tile">
        <div class="tile-value">{stats.summary.totalTokens.toLocaleString()}</div>
        <div class="tile-label">Tokens</div>
      </div>
      <div class="tile">
        <div class="tile-value">{successRate}%</div>
        <div class="tile-label">Success rate</div>
      </div>
    </div>

    {#if modelEntries.length > 0}
      <h3>Tokens per model</h3>
      <div class="bars">
        {#each modelEntries as [name, model]}
          <div class="bar-row">
            <span class="bar-label" title={name}>{name}</span>
            <div class="bar-track">
              <div class="bar" style="width: {Math.round((model.tokensUsed / maxModelTokens) * 100)}%"></div>
            </div>
            <span class="bar-value">{model.tokensUsed.toLocaleString()}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if typeEntries.length > 0}
      <h3>Actions by type</h3>
      <table>
        <thead>
          <tr><th>Type</th><th>Total</th><th>Success</th></tr>
        </thead>
        <tbody>
          {#each typeEntries as [type, info]}
            <tr>
              <td>{type}</td>
              <td>{info.count}</td>
              <td>{info.successCount}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    {#if stats.recentActions.length > 0}
      <h3>Recent actions</h3>
      <table>
        <thead>
          <tr><th>Time</th><th>Type</th><th>Model</th><th>Tokens</th><th>Status</th></tr>
        </thead>
        <tbody>
          {#each stats.recentActions.slice(0, 10) as action (action.id)}
            <tr>
              <td>{formatTime(action.timestamp)}</td>
              <td>{action.type}</td>
              <td class="model">{action.model}</td>
              <td>{(action.inputTokens + action.outputTokens).toLocaleString()}</td>
              <td>{action.status === 'success' ? '✅' : '❌'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</section>

<style>
  .analytics-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.75rem;
    background: var(--vscode-editor-background);
    overflow-y: auto;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
  }

  h3 {
    margin: 0.5rem 0 0;
    font-size: 0.85rem;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
  }

  button {
    padding: 0.3rem 0.7rem;
    background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    color: var(--vscode-button-secondaryForeground, inherit);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.4rem;
    font-size: 0.8rem;
    cursor: pointer;
  }

  button:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .empty {
    color: var(--vscode-descriptionForeground);
    font-size: 0.9rem;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .tile {
    padding: 0.7rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.5rem;
    background: var(--vscode-editorWidget-background);
    text-align: center;
  }

  .tile-value {
    font-size: 1.25rem;
    font-weight: 700;
  }

  .tile-label {
    font-size: 0.72rem;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
  }

  .bars {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .bar-row {
    display: grid;
    grid-template-columns: minmax(80px, 160px) 1fr auto;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
  }

  .bar-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-track {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 999px;
    height: 0.5rem;
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--vscode-button-background);
    transition: width 0.3s ease;
  }

  .bar-value {
    color: var(--vscode-descriptionForeground);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }

  th,
  td {
    text-align: left;
    padding: 0.25rem 0.5rem 0.25rem 0;
    border-bottom: 1px solid var(--vscode-editorWidget-border);
  }

  th {
    color: var(--vscode-descriptionForeground);
    font-weight: 600;
  }

  .model {
    max-width: 9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
