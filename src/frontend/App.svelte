<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import ChatPanel from './components/ChatPanel.svelte';
  import TokenGauge from './components/TokenGauge.svelte';
  import CheckpointPanel from './components/CheckpointPanel.svelte';
  import AnalyticsPanel from './components/AnalyticsPanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import DiffReviewPanel from './components/DiffReviewPanel.svelte';
  import Icon from './components/Icon.svelte';

  import { fly, fade } from 'svelte/transition';
  import { APP_NAME } from './shared/constants';
  import type {
    Message,
    Badge,
    TokenUsage,
    AnalyticsStats,
    JarvisConfig,
    SettingsDefaults,
    DocsSiteStatus,
    McpServerStatus,
    ApprovalRequest,
    PendingFileChange
  } from './shared/types';
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

  // Largeur de la webview (pas de l'écran) : dans une webview, window.innerWidth
  // est la largeur du panneau — c'est notre breakpoint « conteneur ».
  let innerWidth = $state(600);
  const isNarrow = $derived(innerWidth < 500);
  let drawerOpen = $state(false);

  let connectionStatus = $state('Connecting…');
  let tokensUsed = $state(0);
  let tokensLimit = $state<number | null>(null);
  let tokenUsage = $state<TokenUsage | null>(null);
  let messages = $state<Message[]>([]);
  let isSending = $state(false);
  let activeTab = $state<Tab>('chat');
  let checkpoints = $state<Checkpoint[]>([]);
  let analyticsStats = $state<AnalyticsStats | null>(null);
  let availableModels = $state<string[]>([]);
  let currentModel = $state('');
  let showThinking = $state(true);
  let settings = $state<JarvisConfig | null>(null);
  let settingsDefaults = $state<SettingsDefaults | null>(null);
  let docsStatuses = $state<DocsSiteStatus[]>([]);
  let currentFolder = $state('');
  let workspaces = $state<Array<{ id: string; name: string }>>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let indexStatus = $state<{ indexing: boolean; fileCount: number } | null>(null);
  let needsSetup = $state(false);
  let saveStatus = $state<{ ok: boolean; error?: string; pending?: boolean } | null>(null);
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let extraCommands = $state<CommandItem[]>([]);
  let mcpServers = $state<McpServerStatus[]>([]);
  let fileSuggestions = $state<string[]>([]);
  let approvalRequest = $state<ApprovalRequest | null>(null);
  let pendingChanges = $state<PendingFileChange[]>([]);

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

  function appendToLastThinking(text: string) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && last.kind === 'thinking') {
      messages = [
        ...messages.slice(0, -1),
        { ...last, content: last.content + text }
      ];
    } else {
      pushMessage('assistant', text, 'thinking', [{ icon: '', label: 'Thinking', variant: 'info' }]);
    }
  }

  function onWindowMessage(event: MessageEvent) {
    const msg = event.data as {
      type: string;
      defaults?: SettingsDefaults;
      sites?: DocsSiteStatus[];
      currentFolder?: string;
      workspaces?: Array<{ id: string; name: string }>;
      activeWorkspaceId?: string | null;
      indexing?: boolean;
      fileCount?: number;
      text?: string;
      chunk?: string;
      error?: string;
      data?: string;
      tokensUsed?: number;
      tokensLimit?: number | null;
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
      prompts?: Array<{ name: string; description: string }>;
      servers?: McpServerStatus[];
      files?: string[];
      id?: string;
      actionType?: string;
      description?: string;
      detail?: string;
      changes?: PendingFileChange[];
    };

    switch (msg.type) {
      case 'status':
        if (msg.text) connectionStatus = msg.text;
        if (msg.models) availableModels = msg.models;
        if (msg.model !== undefined) currentModel = msg.model;
        if (msg.needsSetup !== undefined) needsSetup = msg.needsSetup;
        break;
      case 'settings':
        if (msg.config) {
          settings = msg.config;
          showThinking = msg.config.optimization?.showThinking ?? true;
        }
        if (msg.defaults) settingsDefaults = msg.defaults;
        if (msg.currentFolder !== undefined) currentFolder = msg.currentFolder;
        if (msg.needsSetup !== undefined) needsSetup = msg.needsSetup;
        break;
      case 'settingsSaved':
        saveStatus = { ok: msg.ok ?? false, error: msg.error };
        // La confirmation s'efface seule ; une erreur reste affichée.
        clearTimeout(saveStatusTimer);
        if (msg.ok) {
          saveStatusTimer = setTimeout(() => (saveStatus = null), 4000);
        }
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
        const promptItems: CommandItem[] = (msg.prompts ?? []).map(p => ({
          trigger: '/' as const,
          insert: `/${p.name} `,
          label: `/${p.name}`,
          detail: p.description || 'Saved prompt'
        }));
        extraCommands = [...agentItems, ...workflowItems, ...promptItems];
        if (msg.workspaces) workspaces = msg.workspaces;
        if (msg.activeWorkspaceId !== undefined) activeWorkspaceId = msg.activeWorkspaceId;
        break;
      }
      case 'indexStatus':
        indexStatus = { indexing: msg.indexing ?? false, fileCount: msg.fileCount ?? 0 };
        break;
      case 'mcpStatus':
        mcpServers = msg.servers ?? [];
        break;
      case 'fileSuggestions':
        fileSuggestions = msg.files ?? [];
        break;
      case 'approvalRequest':
        approvalRequest = {
          id: msg.id ?? '',
          actionType: msg.actionType ?? '',
          description: msg.description ?? '',
          detail: msg.detail ?? ''
        };
        break;
      case 'pendingChanges':
        pendingChanges = msg.changes ?? [];
        break;
      case 'docsStatus':
        // Fusion par id : une mise à jour partielle ne doit pas effacer les autres sites.
        for (const site of msg.sites ?? []) {
          const idx = docsStatuses.findIndex(s => s.id === site.id);
          if (idx === -1) docsStatuses = [...docsStatuses, site];
          else docsStatuses = docsStatuses.map((s, i) => (i === idx ? site : s));
        }
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
      case 'sessionStarted':
        messages = [];
        isSending = false;
        break;
      case 'sessionResumed':
        messages = [];
        isSending = false;
        if (msg.title) {
          pushMessage('assistant', `*(Contexte restauré : ${msg.title})*`);
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
        pushMessage('assistant', `Error: ${msg.error ?? 'unknown'}`, 'text', [
          { icon: '', label: 'Failed', variant: 'error' }
        ]);
        if (msg.needsSetup !== undefined) needsSetup = msg.needsSetup;
        isSending = false;
        break;
      case 'agentThinking':
        if (msg.text) {
          pushMessage('assistant', msg.text, 'thinking', [
            { icon: '', label: 'Thinking', variant: 'info' }
          ]);
        }
        break;
      case 'agentThinkingChunk':
        if (msg.chunk) appendToLastThinking(msg.chunk);
        break;
      case 'agentFinalChunk':
        if (msg.chunk) appendToLastAssistant(msg.chunk);
        break;
      case 'agentTool':
        pushMessage(
          'assistant',
          '',
          'tool',
          [{ icon: '', label: `Tool: ${msg.tool}`, variant: 'info' }]
        );
        break;
      case 'agentToolResult':
        pushMessage(
          'assistant',
          msg.summary ?? '',
          'tool',
          [
            msg.success
              ? { icon: '', label: 'Success', variant: 'success' }
              : { icon: '', label: 'Failed', variant: 'error' }
          ]
        );
        break;
      case 'workflowStep':
        pushMessage(
          'assistant',
          `Step ${msg.index}/${msg.total}: ${msg.step}`,
          'step',
          [{ icon: '', label: 'Workflow', variant: 'info' }]
        );
        break;
      case 'agentFinal':
        if (msg.text) {
          pushMessage('assistant', msg.text, 'text', msg.badges);
        } else if (msg.badges) {
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
            const m = messages[lastIdx];
            messages = [
              ...messages.slice(0, -1),
              { ...m, badges: [...(m.badges || []), ...msg.badges] }
            ];
          }
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

  function handleSend(rawText: string) {
    if (!rawText.trim() || isSending) return;
    
    let mode = 'Automatique';
    let text = rawText;
    const separatorIndex = rawText.indexOf('|');
    if (separatorIndex !== -1) {
      mode = rawText.slice(0, separatorIndex);
      text = rawText.slice(separatorIndex + 1);
    }
    
    pushMessage('user', text.trim());
    isSending = true;
    vscode?.postMessage({ type: 'chatMessage', text: text.trim(), mode });
  }

  function handleTabChange(tab: string) {
    activeTab = tab as Tab;
    drawerOpen = false;
    if (tab === 'checkpoints') {
      vscode?.postMessage({ type: 'listCheckpoints' });
    } else if (tab === 'analytics') {
      vscode?.postMessage({ type: 'getAnalytics' });
    } else if (tab === 'settings') {
      saveStatus = null;
      vscode?.postMessage({ type: 'getSettings' });
      vscode?.postMessage({ type: 'getMcpStatus' });
      vscode?.postMessage({ type: 'getDocsStatus' });
      vscode?.postMessage({ type: 'getIndexStatus' });
    }
  }

  function handleSaveSettings(config: JarvisConfig) {
    clearTimeout(saveStatusTimer);
    saveStatus = { ok: true, pending: true };
    try {
      vscode?.postMessage({ type: 'updateSettings', scope: 'global', config });
    } catch (err) {
      // postMessage clone la config (structured clone) : une valeur non
      // sérialisable ne doit jamais faire échouer la sauvegarde en silence.
      saveStatus = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function handleIndexDocs(id: string) {
    vscode?.postMessage({ type: 'indexDocs', id });
  }

  function handleOpenConfig() {
    vscode?.postMessage({ type: 'openConfigFile' });
  }

  function handleWorkspaceChange(id: string | null) {
    activeWorkspaceId = id;
    vscode?.postMessage({ type: 'setActiveWorkspace', id });
  }

  function handleReindex() {
    vscode?.postMessage({ type: 'indexWorkspace' });
  }

  function handleQueryFiles(query: string) {
    vscode?.postMessage({ type: 'queryFiles', query });
  }

  function handleApprovalRespond(decision: 'allow' | 'allow-session' | 'deny', feedback?: string) {
    const id = approvalRequest?.id;
    approvalRequest = null;
    if (id) vscode?.postMessage({ type: 'approvalResponse', id, decision, feedback });
  }

  function handleResolveHunk(path: string, hunkId: number, revision: number, action: 'accept' | 'reject') {
    vscode?.postMessage({ type: 'resolveHunk', path, hunkId, revision, action });
  }

  function handleResolveFile(path: string, action: 'accept' | 'reject') {
    vscode?.postMessage({ type: 'resolveFile', path, action });
  }

  function handleResolveAll(action: 'accept' | 'reject') {
    vscode?.postMessage({ type: 'resolveAll', action });
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

  function handleRefreshAnalytics() {
    vscode?.postMessage({ type: 'getAnalytics' });
  }

  function handleExportAnalytics() {
    vscode?.postMessage({ type: 'exportAnalytics' });
  }



  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && drawerOpen) {
      drawerOpen = false;
    }
  }
</script>

<svelte:window onmessage={onWindowMessage} onkeydown={handleWindowKeydown} bind:innerWidth />

<div class="app-shell">
  <header class="app-header">
    <div class="header-left">
      {#if isNarrow}
        <button
          class="menu-btn"
          title="Menu"
          aria-label="Toggle navigation"
          onclick={() => (drawerOpen = !drawerOpen)}
        >
          <Icon name={drawerOpen ? 'close' : 'menu'} />
        </button>
      {/if}
      <h1>{APP_NAME}</h1>
      <div class="header-actions" style="display: flex; gap: 4px; margin-left: 8px;">
        <button
          class="menu-btn"
          title="New Conversation (/new)"
          onclick={() => handleSend('/new')}
          disabled={isSending}
        >
          <Icon name="add" />
        </button>
        <button
          class="menu-btn"
          title="Past Conversations (/resume)"
          onclick={() => handleSend('/resume')}
          disabled={isSending}
        >
          <Icon name="history" />
        </button>
      </div>
    </div>
    <div class="header-right">
      <span
        class="status-dot"
        class:success={!needsSetup && connectionStatus.startsWith('Connected')}
        title={connectionStatus}
      ></span>
    </div>
  </header>

  <div class="app-layout" class:narrow={isNarrow}>
    {#if !isNarrow}
      <Sidebar {activeTab} onTabChange={handleTabChange} />
    {/if}
    <main class="main-content">
      {#if activeTab === 'chat'}

        {#if needsSetup}
          <div class="setup-banner">
            <span>No model configured yet.</span>
            <button onclick={openSettings}>Open Settings</button>
          </div>
        {/if}
        <DiffReviewPanel
          files={pendingChanges}
          onResolveHunk={handleResolveHunk}
          onResolveFile={handleResolveFile}
          onResolveAll={handleResolveAll}
        />
        <ChatPanel
          {messages}
          {isSending}
          {showThinking}
          {extraCommands}
          {fileSuggestions}
          {workspaces}
          {activeWorkspaceId}
          {approvalRequest}
          {availableModels}
          {currentModel}
          onSend={handleSend}
          onQueryFiles={handleQueryFiles}
          onWorkspaceChange={handleWorkspaceChange}
          onApprovalRespond={handleApprovalRespond}
          onModelChange={handleModelChange}
          onNewChat={() => handleSend('/new')}
          onResumeChat={() => vscode?.postMessage({ type: 'chatMessage', text: '/resume', mode: 'Automatique' })}
        />
        <TokenGauge
          used={tokensUsed}
          limit={tokensLimit}
          inputTokens={tokenUsage?.inputTokens ?? 0}
          outputTokens={tokenUsage?.outputTokens ?? 0}
          history={tokenUsage?.history ?? []}
        />
      {:else if activeTab === 'settings'}
        <SettingsPanel
          {settings}
          defaults={settingsDefaults}
          {saveStatus}
          {mcpServers}
          {docsStatuses}
          {currentFolder}
          {indexStatus}
          onSave={handleSaveSettings}
          onIndexDocs={handleIndexDocs}
          onReindex={handleReindex}
          onOpenConfig={handleOpenConfig}
        />
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

  {#if isNarrow && drawerOpen}
    <div
      class="drawer-backdrop"
      transition:fade={{ duration: 120 }}
      onclick={() => (drawerOpen = false)}
      onkeydown={e => e.key === 'Enter' && (drawerOpen = false)}
      role="button"
      tabindex="-1"
      aria-label="Close navigation"
    ></div>
    <div class="drawer" transition:fly={{ x: -240, duration: 180 }}>
      <Sidebar {activeTab} onTabChange={handleTabChange} />
    </div>
  {/if}
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    /* height (et non min-height) : le scroll doit vivre dans .main-content,
       pas sur le document — sinon le header (et son bouton ☰ en mode étroit)
       disparaît dès qu'on défile une page longue comme les Settings. */
    height: 100vh;
    overflow: hidden;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif);
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--jarvis-space-2);
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-panel-background);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-2);
    min-width: 0;
  }

  .app-header h1 {
    margin: 0;
    font-size: var(--jarvis-text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
  }

  .menu-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px;
    background: transparent;
    border: none;
    border-radius: var(--jarvis-radius-sm);
    color: inherit;
    cursor: pointer;
    transition: background var(--jarvis-transition);
  }

  .menu-btn:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-2);
    min-width: 0;
  }

  .status-dot {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: var(--jarvis-radius-pill);
    background: var(--jarvis-gold);
  }

  .status-dot.success {
    background: var(--vscode-terminal-ansiGreen);
  }

  .app-layout {
    display: grid;
    grid-template-columns: 220px 1fr;
    flex: 1;
    min-height: 0;
  }

  .app-layout.narrow {
    grid-template-columns: 1fr;
  }

  .main-content {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-3);
    padding: var(--jarvis-space-3);
    overflow: auto;
    min-width: 0;
  }

  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 20;
  }

  .drawer {
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    width: 240px;
    max-width: 85vw;
    z-index: 21;
    display: flex;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.3);
  }

  .drawer > :global(aside) {
    flex: 1;
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
    padding: 5px 12px;
    background: var(--jarvis-accent);
    color: var(--jarvis-accent-fg);
    border: none;
    border-radius: var(--jarvis-radius-pill);
    cursor: pointer;
    font-size: var(--jarvis-text-sm);
    white-space: nowrap;
    transition: background var(--jarvis-transition);
  }

  .setup-banner button:hover {
    background: var(--jarvis-accent-hover);
  }
</style>
