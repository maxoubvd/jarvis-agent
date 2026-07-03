<script lang="ts">
  export let tokens = 0;
</script>

<div class="token-stats">
  <h4>Tokens</h4>
  <p>{tokens} utilisés</p>
</div>

<style>
  .token-stats {
    padding: 1rem;
    border-radius: 0.75rem;
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-editor-foreground);
  }
</style>
