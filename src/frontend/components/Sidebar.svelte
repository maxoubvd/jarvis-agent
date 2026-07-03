<script lang="ts">
  export let title = 'Sidebar';
</script>

<aside class="sidebar">
  <header><h2>{title}</h2></header>
  <div class="section">Aucun élément pour l'instant.</div>
</aside>

<style>
  .sidebar {
    padding: 1rem;
    width: 100%;
    box-sizing: border-box;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-sideBar-foreground);
  }

  header h2 {
    margin: 0 0 1rem;
  }
</style>
