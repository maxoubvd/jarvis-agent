<script lang="ts">
  interface Props {
    activeTab?: string;
    onTabChange?: (tab: string) => void;
  }

  let { activeTab = 'chat', onTabChange = () => {} }: Props = $props();

  const tabs = [
    { id: 'chat', label: '💬 Chat' },
    { id: 'checkpoints', label: '🕒 Checkpoints' }
  ];
</script>

<aside class="sidebar">
  <div class="section-title">Navigation</div>
  <nav class="tabs">
    {#each tabs as tab (tab.id)}
      <button
        class="tab"
        class:active={activeTab === tab.id}
        onclick={() => onTabChange(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  <div class="hint">
    <div class="hint-title">Commandes</div>
    <code>@read &lt;fichier&gt;</code>
    <code>@list &lt;dossier&gt;</code>
    <code>@write &lt;fichier&gt; ...</code>
    <code>@run &lt;commande&gt;</code>
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 0.75rem;
    box-sizing: border-box;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-sideBar-foreground);
    border-right: 1px solid var(--vscode-panel-border);
  }

  .section-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
  }

  .tabs {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tab {
    padding: 0.5rem 0.6rem;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--vscode-sideBar-foreground);
    cursor: pointer;
    font-size: 0.9rem;
  }

  .tab:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .tab.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }

  .hint {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: auto;
    padding-top: 1rem;
    border-top: 1px solid var(--vscode-panel-border);
  }

  .hint-title {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 0.15rem;
  }

  code {
    font-size: 0.72rem;
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground);
  }
</style>
