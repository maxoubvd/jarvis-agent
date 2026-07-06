<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    activeTab?: string;
    onTabChange?: (tab: string) => void;
  }

  let { activeTab = 'chat', onTabChange = () => {} }: Props = $props();

  const tabs = [
    { id: 'chat', label: 'Chat', icon: 'chat' },
    { id: 'checkpoints', label: 'Checkpoints', icon: 'history' },
    { id: 'analytics', label: 'Analytics', icon: 'graph' },
    { id: 'settings', label: 'Settings', icon: 'gear' }
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
        <Icon name={tab.icon} size={15} />
        {tab.label}
      </button>
    {/each}
  </nav>

  <div class="hint">
    <div class="hint-title">Commands</div>
    <code>/agent &lt;task&gt;</code>
    <code>/tdd &lt;task&gt;</code>
    <code>/workflow &lt;id&gt; &lt;task&gt;</code>
    <code>@QA-Agent, @Doc-Agent…</code>
    <code>@file:path @docs:topic</code>
    <code>@read @list @write @run</code>
  </div>
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-4);
    padding: var(--jarvis-space-4) var(--jarvis-space-3);
    box-sizing: border-box;
    background: var(--vscode-sideBar-background);
    color: var(--vscode-sideBar-foreground);
    border-right: 1px solid var(--vscode-panel-border);
  }

  .section-title {
    font-size: var(--jarvis-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
  }

  .tabs {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-1);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-2);
    padding: 7px 10px;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: var(--jarvis-radius-md);
    color: var(--vscode-sideBar-foreground);
    cursor: pointer;
    font-size: var(--jarvis-text-md);
    font-family: inherit;
    transition: background var(--jarvis-transition);
  }

  .tab:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .tab.active {
    background: var(--jarvis-accent-dim);
    box-shadow: inset 2px 0 0 var(--jarvis-accent);
    color: inherit;
  }

  .hint {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-1);
    margin-top: auto;
    padding-top: var(--jarvis-space-4);
    border-top: 1px solid var(--vscode-panel-border);
  }

  .hint-title {
    font-size: var(--jarvis-text-xs);
    font-weight: 700;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 2px;
  }

  code {
    font-size: var(--jarvis-text-xs);
    font-family: var(--vscode-editor-font-family, monospace);
    color: var(--vscode-descriptionForeground);
  }
</style>
