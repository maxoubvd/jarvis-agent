<script lang="ts">
  import { clamp } from '../shared/utils';
  import type { RequestTokenRecord } from '../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    used?: number;
    /** Longueur de contexte du modèle ; `null` = aucun modèle configuré. */
    limit?: number | null;
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    history?: RequestTokenRecord[];
  }

  let { used = 0, limit = null, inputTokens = 0, outputTokens = 0, cachedTokens = 0, history = [] }: Props = $props();

  const percentage = $derived(limit ? clamp(Math.round((used / limit) * 100), 0, 100) : 0);
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
    <span class="gauge-title">
      Tokens used <Icon name={showDetails ? 'chevron-up' : 'chevron-down'} size={11} />
    </span>
    <span>{used.toLocaleString()} / {limit ? limit.toLocaleString() : '—'} ({percentage}%)</span>
  </button>
  <div class="gauge">
    <div class="meter {colorClass}" style="width: {percentage}%"></div>
  </div>

  {#if percentage >= 80}
    <div class="limit-warning">
      <Icon name="warning" size={12} /> Approaching the model's context limit
    </div>
  {/if}

  {#if showDetails}
    <div class="details">
      <p class="explain">
        Counts are estimates (~4 characters ≈ 1 token), accumulated over this whole discussion.
        The limit is the model's context window — from your model settings, or a built-in default
        for known model families. Past 80% a warning appears: the model may start losing earlier
        context, and a request exceeding the limit usually fails with a provider error — local
        runtimes like Ollama instead silently drop the oldest messages. Use /new to start a fresh
        discussion and reset the counter.
      </p>
      <div class="split">
        <span>Input: {inputTokens.toLocaleString()}</span>
        <span>Output: {outputTokens.toLocaleString()}</span>
        {#if cachedTokens > 0}
          <span class="cached" title="Prompt tokens served from the provider cache (cost & latency savings)">
            ⚡ Cached: {cachedTokens.toLocaleString()}
          </span>
        {/if}
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
    font-size: var(--jarvis-text-sm);
    margin-bottom: 0.35rem;
    color: var(--vscode-descriptionForeground);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: inherit;
  }

  .gauge-title {
    display: inline-flex;
    align-items: center;
    gap: 2px;
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
    background: var(--jarvis-gold);
  }

  .meter.orange {
    background: var(--vscode-terminal-ansiYellow);
  }

  .meter.red {
    background: var(--jarvis-accent);
  }

  .limit-warning {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 0.35rem;
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-terminal-ansiYellow);
  }

  .details {
    margin-top: 0.5rem;
    font-size: 0.78rem;
    color: var(--vscode-descriptionForeground);
  }

  .explain {
    margin: 0 0 0.4rem;
    font-size: var(--jarvis-text-xs);
    line-height: 1.5;
    color: var(--vscode-descriptionForeground);
  }

  .split {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
    margin-bottom: 0.4rem;
  }

  .cached {
    color: var(--vscode-terminal-ansiGreen);
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
