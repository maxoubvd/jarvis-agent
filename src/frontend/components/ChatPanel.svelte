<script lang="ts">
  export let title = 'Chat';
</script>

<section class="chat-panel">
  <header>
    <h2>{title}</h2>
  </header>
  <div class="messages">Aucun message pour le moment.</div>
</section>

<style>
  .chat-panel {
    padding: 1rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.75rem;
    background: var(--vscode-editor-background);
  }

  header h2 {
    margin: 0 0 0.75rem;
  }

  .messages {
    color: var(--vscode-editor-foreground);
  }
</style>
