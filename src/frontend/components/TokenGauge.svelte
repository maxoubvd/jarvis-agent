<script lang="ts">
  export let used = 0;
  export let limit = 10000;

  const percentage = () => Math.min(100, Math.round((used / limit) * 100));
</script>

<div class="gauge">
  <div class="meter" style="width: {percentage()}%"></div>
  <span>{percentage()}% utilisé</span>
</div>

<style>
  .gauge {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 999px;
    overflow: hidden;
    position: relative;
    height: 1rem;
  }

  .meter {
    height: 100%;
    background: var(--vscode-terminal-ansiGreen);
  }

  span {
    display: block;
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: var(--vscode-editor-foreground);
  }
</style>
