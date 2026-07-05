<script lang="ts">
  import { clamp } from '../shared/utils';

  interface Props {
    used?: number;
    limit?: number;
  }

  let { used = 0, limit = 10000 }: Props = $props();

  const percentage = $derived(clamp(Math.round((used / limit) * 100), 0, 100));
  const colorClass = $derived(percentage < 50 ? 'green' : percentage < 80 ? 'orange' : 'red');
</script>

<div class="gauge-wrapper">
  <div class="gauge-header">
    <span>Tokens utilisés</span>
    <span>{used.toLocaleString()} / {limit.toLocaleString()} ({percentage}%)</span>
  </div>
  <div class="gauge">
    <div class="meter {colorClass}" style="width: {percentage}%"></div>
  </div>
</div>

<style>
  .gauge-wrapper {
    margin-top: auto;
  }

  .gauge-header {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    margin-bottom: 0.35rem;
    color: var(--vscode-descriptionForeground);
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
</style>
