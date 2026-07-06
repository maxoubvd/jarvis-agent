<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import ChatPanel from './components/ChatPanel.svelte';
  import TokenGauge from './components/TokenGauge.svelte';
  import CheckpointPanel from './components/CheckpointPanel.svelte';
  import AnalyticsPanel from './components/AnalyticsPanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { APP_NAME } from './shared/constants';
  import type { Message, Badge, TokenUsage, AnalyticsStats, JarvisConfig } from './shared/types';
  import type { CommandItem } from './shared/commands';
  import vscode from './lib/vscode-api';

  type Tab = 'chat' | 'checkpoints' | 'analytics' | 'settings';

  interface Checkpoint {
    id: string;
    ref: string;
    type: string;
    description: string;
    timestamp: string;
  }

  let connectionStatus = $state('Connecting…');
  let tokensUsed = $state(0);
  let tokensLimit = $state(32768);
  let tokenUsage = $state<TokenUsage | null>(null);
  let messages = $state<Message[]>([]);
  let isSending = $state(false);
  let activeTab = $state<Tab>('chat');
  let checkpoints = $state<Checkpoint[]>([]);
  let analyticsStats = $state<AnalyticsStats | null>(null);
  let availableModels = $state<string[]>([]);
  let currentModel = $state('');
  let hitlMode = $state('moderate');
  let showThinking = $state(true);
  let settings = $state<JarvisConfig | null>(null);
  let needsSetup = $state(false);
  let saveStatus = $state<{ ok: boolean; error?: string } | null>(null);
  let extraCommands = $state<CommandItem[]>([]);
  let mcpServers = $state<Array<{ name: string; enabled: boolean; connected: boolean; tools: string[]; error?: string }>>([]);

  function pushMessage(role: Message['role'], content: string, kind?: Message['kind'], badges?: Badge[]) {
    messages = [
      ...messages,
      { id: crypto.randomUUID(), role, content, timestamp: Date.now(), kind, badges }
    ];
  }

  function appendToLastAssistant(text: string) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && (last.kind === 'text' || last.kind === undefined)) {
      messages = [
        ...messages.slice(0, -1),
        { ...last, content: last.content + text }
      ];
    } else {
      pushMessage('assistant', text);
    }
  }

  function onWindowMessage(event: MessageEvent) {
    const msg = event.data as {
      type: string;
      text?: string;
      error?: string;
      data?: string;
      tokensUsed?: number;
      tokensLimit?: number;
      usage?: TokenUsage;
      checkpoints?: Checkpoint[];
      stats?: AnalyticsStats | null;
      models?: string[];
      model?: string;
      tool?: string;
      args?: Record<string, unknown>;
      success?: boolean;
      summary?: string;
      step?: string;
      index?: number;
      total?: number;
      badges?: Badge[];
      needsSetup?: boolean;
      config?: JarvisConfig;
      ok?: boolean;
      agents?: Array<{ mention: string; label: string }>;
      workflows?: Array<{ id: string; label: string }>;
      servers?: Array<{ name: string; enabled: boolean; connected: boolean; tools: string[]; error?: string }>;
    };

    switch (msg.type) {
      case 'status':
        if (msg.text) connectionStatus = msg.text;
        if (msg.models) availableModels = msg.models;
        if (msg.model !== undefined) currentModel = msg.model;
        if (msg.needsSetup !== undefined) needsSetup = msg.needsSetup;
        break;
      case 'settings':
        if (msg.config) settings = msg.config;
        if (msg.needsSetup !== undefined) needsSetup = msg.needsSetup;
        break;
      case 'settingsSaved':
        saveStatus = { ok: msg.ok ?? false, error: msg.error };
        break;
      case 'capabilities': {
        const agentItems: CommandItem[] = (msg.agents ?? []).map(a => ({
          trigger: '@' as const,
          insert: `${a.mention} `,
          label: a.mention,
          detail: a.label
        }));
        const workflowItems: CommandItem[] = (msg.workflows ?? []).map(w => ({
          trigger: '/' as const,
          insert: `/workflow ${w.id} `,
          label: `/workflow ${w.id}`,
          detail: w.label
        }));
        extraCommands = [...agentItems, ...workflowItems];
        break;
      }
      case 'mcpStatus':
        mcpServers = msg.servers ?? [];
        break;
      case 'tokens':
        if (msg.usage) {
          tokenUsage = msg.usage;
          tokensUsed = msg.usage.used;
          tokensLimit = msg.usage.limit;
        } else {
          if (msg.tokensUsed !== undefined) tokensUsed = msg.tokensUsed;
          if (msg.tokensLimit !== undefined) tokensLimit = msg.tokensLimit;
        }
        break;
      case 'chatStart':
        pushMessage('assistant', '');
        break;
      case 'chatChunk':
        if (msg.text) appendToLastAssistant(msg.text);
        break;
      case 'terminalOutput':
        if (msg.data) appendToLastAssistant(msg.data);
        break;
      case 'chatDone':
        isSending = false;
        break;
      case 'chatError':
        pushMessage('assistant', `❌ Error: ${msg.error ?? 'unknown'}`, 'text', [
          { icon: '❌', label: 'Failed', variant: 'error' }
        ]);
        if (msg.needsSetup !== undefined) needsSetup = msg.needsSetup;
        isSending = false;
        break;
      case 'agentThinking':
        if (msg.text) {
          pushMessage('assistant', msg.text, 'thinking', [
            { icon: '🧠', label: 'Thinking', variant: 'info' }
          ]);
        }
        break;
      case 'agentTool':
        pushMessage(
          'assistant',
          `${msg.tool}(${JSON.stringify(msg.args ?? {})})`,
          'tool',
          [{ icon: '🔧', label: `Tool: ${msg.tool}`, variant: 'info' }]
        );
        break;
      case 'agentToolResult':
        pushMessage(
          'assistant',
          msg.summary ?? '',
          'tool',
          [
            msg.success
              ? { icon: '✅', label: 'Success', variant: 'success' }
              : { icon: '❌', label: 'Failed', variant: 'error' }
          ]
        );
        break;
      case 'workflowStep':
        pushMessage(
          'assistant',
          `Step ${msg.index}/${msg.total}: ${msg.step}`,
          'step',
          [{ icon: '⏱️', label: 'Workflow', variant: 'info' }]
        );
        break;
      case 'agentFinal':
        if (msg.text) {
          pushMessage('assistant', msg.text, 'text', msg.badges);
        }
        isSending = false;
        break;
      // Legacy single-shot message (kept for backward compatibility)
      case 'chatMessage':
        if (msg.text) {
          pushMessage('assistant', msg.text);
          isSending = false;
        }
        break;
      case 'checkpoints':
        checkpoints = msg.checkpoints ?? [];
        break;
      case 'analytics':
        analyticsStats = msg.stats ?? null;
        break;
    }
  }

  function handleSend(text: string) {
    if (!text.trim() || isSending) return;
    pushMessage('user', text.trim());
    isSending = true;
    vscode?.postMessage({ type: 'chatMessage', text: text.trim() });
  }

  function handleTabChange(tab: string) {
    activeTab = tab as Tab;
    if (tab === 'checkpoints') {
      vscode?.postMessage({ type: 'listCheckpoints' });
    } else if (tab === 'analytics') {
      vscode?.postMessage({ type: 'getAnalytics' });
    } else if (tab === 'settings') {
      saveStatus = null;
      vscode?.postMessage({ type: 'getSettings' });
      vscode?.postMessage({ type: 'getMcpStatus' });
    }
  }

  function handleSaveSettings(config: JarvisConfig) {
    saveStatus = null;
    vscode?.postMessage({ type: 'updateSettings', scope: 'global', config });
  }

  function openSettings() {
    handleTabChange('settings');
  }

  function handleRollback(ref: string) {
    vscode?.postMessage({ type: 'rollback', ref });
  }

  function handleRefreshCheckpoints() {
    vscode?.postMessage({ type: 'listCheckpoints' });
  }

  function handleModelChange(event: Event) {
    const model = (event.target as HTMLSelectElement).value;
    currentModel = model;
    vscode?.postMessage({ type: 'setModel', model });
  }

  function handleHitlModeChange(mode: string) {
    hitlMode = mode;
    vscode?.postMessage({ type: 'setHitlMode', mode });
  }

  function handleRefreshAnalytics() {
    vscode?.postMessage({ type: 'getAnalytics' });
  }

  function handleExportAnalytics() {
    vscode?.postMessage({ type: 'exportAnalytics' });
  }
</script>

<svelte:window onmessage={onWindowMessage} />

<div class="app-shell">
  <header class="app-header">
    <h1>{APP_NAME}</h1>
    <div class="header-right">
      {#if availableModels.length > 0}
        <select class="model-select" value={currentModel} onchange={handleModelChange}>
          {#each availableModels as model (model)}
            <option value={model}>{model}</option>
          {/each}
        </select>
      {/if}
      <span class="status" class:success={!needsSetup && connectionStatus.startsWith('Connected')}>{connectionStatus}</span>
    </div>
  </header>

  <div class="app-layout">
    <Sidebar
      {activeTab}
      {hitlMode}
      {showThinking}
      onTabChange={handleTabChange}
      onHitlModeChange={handleHitlModeChange}
      onToggleThinking={v => (showThinking = v)}
    />
    <main class="main-content">
      {#if activeTab === 'chat'}
        {#if needsSetup}
          <div class="setup-banner">
            <span>No model configured yet.</span>
            <button onclick={openSettings}>Open Settings</button>
          </div>
        {/if}
        <ChatPanel {messages} {isSending} {showThinking} {extraCommands} onSend={handleSend} />
        <TokenGauge
          used={tokensUsed}
          limit={tokensLimit}
          inputTokens={tokenUsage?.inputTokens ?? 0}
          outputTokens={tokenUsage?.outputTokens ?? 0}
          history={tokenUsage?.history ?? []}
        />
      {:else if activeTab === 'settings'}
        <SettingsPanel {settings} {saveStatus} {mcpServers} onSave={handleSaveSettings} />
      {:else if activeTab === 'checkpoints'}
        <CheckpointPanel
          {checkpoints}
          onRollback={handleRollback}
          onRefresh={handleRefreshCheckpoints}
        />
      {:else if activeTab === 'analytics'}
        <AnalyticsPanel
          stats={analyticsStats}
          onRefresh={handleRefreshAnalytics}
          onExport={handleExportAnalytics}
        />
      {/if}
    </main>
  </div>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif);
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-panel-background);
  }

  .app-header h1 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .model-select {
    padding: 0.25rem 0.4rem;
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
    border-radius: 4px;
    font-size: 0.8rem;
    max-width: 12rem;
  }

  .status {
    font-size: 0.85rem;
    color: var(--vscode-descriptionForeground);
  }

  .status.success {
    color: var(--vscode-terminal-ansiGreen);
  }

  .app-layout {
    display: grid;
    grid-template-columns: 220px 1fr;
    flex: 1;
    min-height: 0;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    overflow: auto;
  }

  .setup-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-editorWidget-border));
    background: var(--vscode-inputValidation-warningBackground, var(--vscode-editorWidget-background));
    border-radius: 0.5rem;
    font-size: 0.85rem;
  }

  .setup-banner button {
    padding: 0.35rem 0.7rem;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
    white-space: nowrap;
  }

  .setup-banner button:hover {
    background: var(--vscode-button-hoverBackground);
  }

  @media (max-width: 640px) {
    .app-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
