<script lang="ts">
  export let successRate = 0;
</script>

<div class="performance">
  <h4>Performance</h4>
  <p>Taux de succès : {successRate}%</p>
</div>

<style>
  .performance {
    padding: 1rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.75rem;
    background: var(--vscode-editor-background);
  }
</style>
