<script lang="ts">
  import { clamp } from '../shared/utils';
  import type { RequestTokenRecord } from '../shared/types';

  interface Props {
    used?: number;
    limit?: number;
    inputTokens?: number;
    outputTokens?: number;
    history?: RequestTokenRecord[];
  }

  let { used = 0, limit = 10000, inputTokens = 0, outputTokens = 0, history = [] }: Props = $props();

  const percentage = $derived(clamp(Math.round((used / limit) * 100), 0, 100));
  const colorClass = $derived(percentage < 50 ? 'green' : percentage < 80 ? 'orange' : 'red');

  let showDetails = $state(false);

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }
</script>

<div class="gauge-wrapper">
  <button class="gauge-header" onclick={() => (showDetails = !showDetails)}>
    <span>Tokens used {showDetails ? '▾' : '▸'}</span>
    <span>{used.toLocaleString()} / {limit.toLocaleString()} ({percentage}%)</span>
  </button>
  <div class="gauge">
    <div class="meter {colorClass}" style="width: {percentage}%"></div>
  </div>

  {#if percentage >= 80}
    <div class="limit-warning">⚠️ Approaching the model's context limit</div>
  {/if}

  {#if showDetails}
    <div class="details">
      <div class="split">
        <span>⬆️ Input: {inputTokens.toLocaleString()}</span>
        <span>⬇️ Output: {outputTokens.toLocaleString()}</span>
      </div>
      {#if history.length > 0}
        <table class="history">
          <thead>
            <tr><th>Time</th><th>Model</th><th>In</th><th>Out</th></tr>
          </thead>
          <tbody>
            {#each history as record}
              <tr>
                <td>{formatTime(record.timestamp)}</td>
                <td class="model">{record.model}</td>
                <td>{record.inputTokens.toLocaleString()}</td>
                <td>{record.outputTokens.toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <div class="no-history">No requests yet</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .gauge-wrapper {
    margin-top: auto;
  }

  .gauge-header {
    display: flex;
    justify-content: space-between;
    width: 100%;
    font-size: 0.85rem;
    margin-bottom: 0.35rem;
    color: var(--vscode-descriptionForeground);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
  }

  .gauge {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 999px;
    overflow: hidden;
    height: 0.5rem;
  }

  .meter {
    height: 100%;
    transition: width 0.3s ease;
  }

  .meter.green {
    background: var(--vscode-terminal-ansiGreen);
  }

  .meter.orange {
    background: var(--vscode-terminal-ansiYellow);
  }

  .meter.red {
    background: var(--vscode-terminal-ansiRed);
  }

  .limit-warning {
    margin-top: 0.35rem;
    font-size: 0.78rem;
    color: var(--vscode-terminal-ansiYellow);
  }

  .details {
    margin-top: 0.5rem;
    font-size: 0.78rem;
    color: var(--vscode-descriptionForeground);
  }

  .split {
    display: flex;
    gap: 1rem;
    margin-bottom: 0.4rem;
  }

  .history {
    width: 100%;
    border-collapse: collapse;
  }

  .history th,
  .history td {
    text-align: left;
    padding: 0.15rem 0.4rem 0.15rem 0;
    border-bottom: 1px solid var(--vscode-editorWidget-border);
  }

  .history .model {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .no-history {
    font-style: italic;
  }
</style>
