<script lang="ts">
  export let text = 'Pensée en cours...';
</script>

<div class="thinking-block">
  <strong>En réflexion</strong>
  <p>{text}</p>
</div>

<style>
  .thinking-block {
    border: 1px dashed var(--vscode-editorWidget-border);
    padding: 0.75rem;
    border-radius: 0.75rem;
    background: var(--vscode-editor-background);
  }

  strong {
    display: block;
    margin-bottom: 0.5rem;
  }
</style>
