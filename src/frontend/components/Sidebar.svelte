<script lang="ts">
  interface Props {
    activeTab?: string;
    hitlMode?: string;
    showThinking?: boolean;
    onTabChange?: (tab: string) => void;
    onHitlModeChange?: (mode: string) => void;
    onToggleThinking?: (show: boolean) => void;
  }

  let {
    activeTab = 'chat',
    hitlMode = 'moderate',
    showThinking = true,
    onTabChange = () => {},
    onHitlModeChange = () => {},
    onToggleThinking = () => {}
  }: Props = $props();

  const tabs = [
    { id: 'chat', label: '💬 Chat' },
    { id: 'checkpoints', label: '🕒 Checkpoints' },
    { id: 'analytics', label: '📊 Analytics' },
    { id: 'settings', label: '⚙️ Settings' }
  ];

  const hitlModes = [
    { id: 'strict', label: 'Strict' },
    { id: 'moderate', label: 'Moderate' },
    { id: 'free', label: 'Free' }
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

  <div class="section-title">HITL</div>
  <select
    class="hitl-select"
    value={hitlMode}
    onchange={e => onHitlModeChange((e.target as HTMLSelectElement).value)}
  >
    {#each hitlModes as mode (mode.id)}
      <option value={mode.id}>{mode.label}</option>
    {/each}
  </select>

  <label class="toggle">
    <input
      type="checkbox"
      checked={showThinking}
      onchange={e => onToggleThinking((e.target as HTMLInputElement).checked)}
    />
    🧠 Thinking
  </label>

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

  .hitl-select {
    padding: 0.35rem 0.4rem;
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
    border-radius: 4px;
    font-size: 0.85rem;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.82rem;
    cursor: pointer;
    color: var(--vscode-sideBar-foreground);
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
