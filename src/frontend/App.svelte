<script lang="ts">
  let message = 'Bienvenue dans Jarvis Agent';
</script>

<main class="app-shell">
  <section class="hero">
    <h1>{message}</h1>
    <p>Extension VS Code pour l'assistance de développement et l'automatisation IA.</p>
  </section>
</main>

<style>
  .app-shell {
    padding: 1.5rem;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif);
  }

  .hero {
    max-width: 720px;
    margin: 1rem auto;
  }

  h1 {
    font-size: 1.75rem;
    margin-bottom: 0.75rem;
  }

  p {
    color: var(--vscode-descriptionForeground);
  }
</style>
