<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import ChatPanel from './components/ChatPanel.svelte';
  import TokenGauge from './components/TokenGauge.svelte';
  import CheckpointPanel from './components/CheckpointPanel.svelte';
  import AnalyticsPanel from './components/AnalyticsPanel.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import DiffReviewPanel from './components/DiffReviewPanel.svelte';
  import WelcomeScreen from './components/WelcomeScreen.svelte';
  import Icon from './components/Icon.svelte';
  import JarvisIcon from './components/JarvisIcon.svelte';

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
    PendingFileChange,
    TodoItem
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

  // Width of the webview (not the screen): inside a webview, window.innerWidth
  // is the panel's width — that's our "container" breakpoint.
  let innerWidth = $state(600);
  const isNarrow = $derived(innerWidth < 500);
  let sidebarOpen = $state(false);

  // Lightweight UI state persisted on the webview side (survives a window reload).
  const persistedUi = (vscode?.getState() as { activeTab?: Tab } | undefined) ?? {};

  // Sync sidebarOpen on size transitions (narrow <=> wide)
  let wasNarrow = false;
  $effect(() => {
    const narrow = isNarrow;
    if (narrow !== wasNarrow) {
      sidebarOpen = !narrow;
      wasNarrow = narrow;
    }
  });

  let connectionStatus = $state('Connecting…');
  let tokensUsed = $state(0);
  let tokensLimit = $state<number | null>(null);
  let tokenUsage = $state<TokenUsage | null>(null);
  let messages = $state<Message[]>([]);
  let isSending = $state(false);
  let activeTab = $state<Tab>(persistedUi.activeTab ?? 'chat');
  let checkpoints = $state<Checkpoint[]>([]);
  let analyticsStats = $state<AnalyticsStats | null>(null);
  let availableModels = $state<string[]>([]);
  let currentModel = $state('');
  let showThinking = $state(true);
  let settings = $state<JarvisConfig | null>(null);
  let settingsDefaults = $state<SettingsDefaults | null>(null);
  let docsStatuses = $state<DocsSiteStatus[]>([]);
  let currentFolder = $state('');
  let avatarUri = $state<string | null>(null);
  let workspaces = $state<Array<{ id: string; name: string }>>([]);
  let activeWorkspaceId = $state<string | null>(null);
  let activeWorkspaceName = $derived(workspaces.find(w => w.id === activeWorkspaceId)?.name || currentFolder.split(/[/\\]/).pop() || 'Workspace');
  let indexStatus = $state<{ indexing: boolean; fileCount: number } | null>(null);
  let needsSetup = $state(false);
  // Onboarding: defaults to `true` so we don't flash the welcome screen for
  // already-configured users (the backend corrects it via `onboardingState`).
  let onboardingDone = $state(true);
  let welcomeDismissed = $state(false);
  let connectionResult = $state<{ ok: boolean; error?: string; sample?: string } | null>(null);
  let testingConnection = $state(false);
  const showWelcome = $derived(!welcomeDismissed && (needsSetup || !onboardingDone));
  let saveStatus = $state<{ ok: boolean; error?: string; pending?: boolean } | null>(null);
  let saveStatusTimer: ReturnType<typeof setTimeout> | undefined;
  let extraCommands = $state<CommandItem[]>([]);
  let mcpServers = $state<McpServerStatus[]>([]);
  let fileSuggestions = $state<string[]>([]);
  let docsSuggestions = $state<string[]>([]);
  let approvalRequest = $state<ApprovalRequest | null>(null);
  let pendingChanges = $state<PendingFileChange[]>([]);
  let todos = $state<TodoItem[]>([]);
  /** Text pushed back into the chat input after a fork (see 'forked' handler below). */
  let pendingDraft = $state<string | null>(null);

  function pushMessage(
    role: Message['role'],
    content: string,
    kind?: Message['kind'],
    badges?: Badge[],
    id?: string
  ) {
    messages = [
      ...messages,
      { id: id ?? crypto.randomUUID(), role, content, timestamp: Date.now(), kind, badges }
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

  function appendToProcessSteps(kind: 'thinking' | 'tool' | 'step', content: string, badges?: Badge[]) {
    let lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
    if (!lastMsg || lastMsg.role !== 'assistant') {
      const newMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now(), processSteps: [] };
      messages = [...messages, newMsg];
      lastMsg = newMsg;
    }

    const processSteps = lastMsg.processSteps || [];

    if (kind === 'thinking' && !badges) {
      const lastStep = processSteps.length > 0 ? processSteps[processSteps.length - 1] : null;
      if (lastStep && lastStep.kind === 'thinking') {
        const newSteps = [...processSteps];
        newSteps[newSteps.length - 1] = { ...lastStep, content: lastStep.content + content };
        messages = [
          ...messages.slice(0, -1),
          { ...lastMsg, processSteps: newSteps }
        ];
        return;
      }
    }

    const newSteps = [
      ...processSteps,
      { id: crypto.randomUUID(), kind, content, badges }
    ];

    messages = [
      ...messages.slice(0, -1),
      { ...lastMsg, processSteps: newSteps }
    ];
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
      done?: boolean;
      sample?: string;
      messages?: Array<{ role: string; content: string }>;
      prompt?: string;
      file?: string;
      startLine?: number;
      endLine?: number;
      docs?: string[];
      items?: TodoItem[];
      uri?: string;
      messageId?: string;
      checkpointId?: string;
      title?: string;
    };

    switch (msg.type) {
      case 'avatarUri':
        if (msg.uri) avatarUri = msg.uri;
        break;
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
        // The confirmation clears itself; an error stays displayed.
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
      case 'docsSuggestions':
        docsSuggestions = msg.docs ?? [];
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
        // Merge by id: a partial update must not erase the other sites.
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
      case 'onboardingState':
        if (msg.done !== undefined) onboardingDone = msg.done;
        break;
      case 'connectionResult':
        testingConnection = false;
        connectionResult = { ok: msg.ok ?? false, error: msg.error, sample: msg.sample };
        break;
      case 'chatHistory':
        if (msg.messages && msg.messages.length > 0) {
          messages = msg.messages.map(m => ({
            id: crypto.randomUUID(),
            role: (m.role === 'user' ? 'user' : 'assistant') as Message['role'],
            content: m.content,
            timestamp: Date.now(),
            kind: 'text' as const
          }));
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
          pushMessage('assistant', `*(Context restored: ${msg.title})*`);
        }
        break;
      case 'chatStart':
        isSending = true;
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
        if (todos.length > 0 && todos.every(t => t.status === 'completed')) {
          todos = [];
        }
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
          appendToProcessSteps('thinking', msg.text, [{ icon: '', label: 'Thinking', variant: 'info' }]);
        }
        break;
      case 'agentThinkingChunk':
        if (msg.chunk) appendToProcessSteps('thinking', msg.chunk);
        break;
      case 'agentFinalChunk':
        if (msg.chunk) appendToLastAssistant(msg.chunk);
        break;
      case 'agentTool':
        appendToProcessSteps('tool', '', [{ icon: '', label: `Tool: ${msg.tool}`, variant: 'info' }]);
        break;
      case 'agentToolResult':
        appendToProcessSteps('tool', msg.summary ?? '', [
          msg.success
            ? { icon: '', label: 'Success', variant: 'success' }
            : { icon: '', label: 'Failed', variant: 'error' }
        ]);
        break;
      case 'workflowStep':
        appendToProcessSteps('step', `Step ${msg.index}/${msg.total}: ${msg.step}`, [{ icon: '', label: 'Workflow', variant: 'info' }]);
        break;
      case 'agentFinal':
        if (msg.text) {
          pushMessage('assistant', msg.text, msg.kind || 'text', msg.badges);
        } else if (msg.badges || msg.kind) {
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
            const m = messages[lastIdx];
            messages = [
              ...messages.slice(0, -1),
              { ...m, kind: msg.kind || m.kind, badges: [...(m.badges || []), ...(msg.badges || [])] }
            ];
          }
        }
        isSending = false;
        break;
      // Legacy single-shot message (kept for backward compatibility)
      case 'injectUserMessage':
        if (msg.text) {
          pushMessage('user', msg.text, undefined, undefined, msg.id);
          isSending = true;
        }
        break;
      case 'inlinePrompt':
        if (msg.prompt) {
          pushMessage('user', msg.prompt, 'inline', [
            { icon: '✎', label: `${msg.file} L${msg.startLine}-${msg.endLine}`, variant: 'info' }
          ], msg.id);
          isSending = true;
        }
        break;
      case 'checkpointLinked':
        if (msg.messageId && msg.checkpointId) {
          const linkedId = msg.messageId;
          const cpId = msg.checkpointId;
          messages = messages.map(m => (m.id === linkedId ? { ...m, checkpointId: cpId } : m));
        }
        break;
      case 'forkable':
        if (msg.messageId) {
          const forkableId = msg.messageId;
          messages = messages.map(m => (m.id === forkableId ? { ...m, forkable: true } : m));
        }
        break;
      case 'forked':
        if (msg.messageId) {
          const idx = messages.findIndex(m => m.id === msg.messageId);
          if (idx !== -1) {
            // The forked message is dropped from the transcript and its text
            // goes back into the input, so the user can edit/resend it.
            pendingDraft = messages[idx].content;
            messages = messages.slice(0, idx);
          }
        }
        isSending = false;
        break;
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
      case 'todoUpdate':
        todos = msg.items ?? [];
        break;
    }
  }

  function handleSend(rawText: string) {
    if (!rawText.trim() || isSending) return;
    
    let mode = 'Automatic';
    let text = rawText;
    const separatorIndex = rawText.indexOf('|');
    if (separatorIndex !== -1) {
      mode = rawText.slice(0, separatorIndex);
      text = rawText.slice(separatorIndex + 1);
    }
    
    const id = crypto.randomUUID();
    pushMessage('user', text.trim(), undefined, undefined, id);
    isSending = true;
    vscode?.postMessage({ type: 'chatMessage', text: text.trim(), mode, id });
  }

  function handlePlanProceed() {
    const id = crypto.randomUUID();
    pushMessage('user', "The plan is approved. Proceed with its implementation step by step.", undefined, undefined, id);
    isSending = true;
    vscode?.postMessage({ type: 'planProceed', id });
  }

  function handleRewindMessage(messageId: string) {
    vscode?.postMessage({ type: 'rewindToMessage', messageId });
  }

  function handleForkMessage(messageId: string) {
    vscode?.postMessage({ type: 'forkConversation', messageId });
  }

  function handleForkAndRewindMessage(messageId: string) {
    vscode?.postMessage({ type: 'forkAndRewind', messageId });
  }

  function persistUiState() {
    vscode?.setState({ ...(vscode?.getState() ?? {}), activeTab });
  }

  function handleTestConnection(item: unknown) {
    testingConnection = true;
    connectionResult = null;
    vscode?.postMessage({ type: 'testConnection', model: item });
  }

  function handleCompleteOnboarding() {
    welcomeDismissed = true;
    onboardingDone = true;
    vscode?.postMessage({ type: 'completeOnboarding' });
  }

  function handleTabChange(tab: string) {
    activeTab = tab as Tab;
    persistUiState();
    if (isNarrow) sidebarOpen = false;
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
      const cleanConfig = $state.snapshot(config);
      vscode?.postMessage({ type: 'updateSettings', scope: 'global', config: cleanConfig });
    } catch (err) {
      // postMessage clones the config (structured clone): a non-serializable
      // value must never make the save fail silently.
      saveStatus = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  function handleIndexDocs(id: string) {
    vscode?.postMessage({ type: 'indexDocs', id });
  }

  function handleOpenConfig() {
    vscode?.postMessage({ type: 'openConfigFile' });
  }

  function handleOpenGuide() {
    vscode?.postMessage({ type: 'openUserGuide' });
  }

  function handleWorkspaceChange(id: string | null) {
    activeWorkspaceId = id;
    vscode?.postMessage({ type: 'setActiveWorkspace', id });
  }

  function handleReindex() {
    vscode?.postMessage({ type: 'indexWorkspace' });
  }

  function handleRequestGitInit(id: string) {
    vscode?.postMessage({ type: 'requestGitInit', id });
  }

  function handleSetHitlMode(mode: string) {
    vscode?.postMessage({ type: 'setHitlMode', mode });
  }

  function handleNewChat() {
    handleSend('/new');
  }

  function handleResumeChat() {
    handleSend('/resume');
  }

  function handleQueryFiles(query: string) {
    vscode?.postMessage({ type: 'queryFiles', query });
  }

  function handleQueryDocs(query: string) {
    vscode?.postMessage({ type: 'queryDocs', query });
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

  function handleRollback(id: string) {
    vscode?.postMessage({ type: 'rollback', id });
  }

  function handleRefreshCheckpoints() {
    vscode?.postMessage({ type: 'listCheckpoints' });
  }

  function handleModelChange(modelOrEvent: Event | string) {
    const model = typeof modelOrEvent === 'string'
      ? modelOrEvent
      : (modelOrEvent.target as HTMLSelectElement).value;
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
    if (event.key === 'Escape' && sidebarOpen && isNarrow) {
      sidebarOpen = false;
    }
  }
</script>

<svelte:window onmessage={onWindowMessage} onkeydown={handleWindowKeydown} bind:innerWidth />

<div class="app-shell">
  {#if showWelcome}
    <WelcomeScreen
      baseConfig={settings}
      hasModel={!needsSetup}
      {connectionResult}
      testing={testingConnection}
      onTest={handleTestConnection}
      onSave={handleSaveSettings}
      onComplete={handleCompleteOnboarding}
    />
  {:else}
  <header class="app-header">
    <div class="header-left" style="display: flex; gap: 2px">
      <button
        class="menu-btn"
        title="Menu"
        aria-label="Toggle navigation"
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        <Icon name={sidebarOpen ? 'close' : 'menu'} />
      </button>
      <JarvisIcon />
      <h1>{APP_NAME}</h1>
      <div class="header-actions">
        <button
          class="menu-btn"
          title="New Conversation (/new)"
          onclick={() => { handleTabChange('chat'); handleNewChat(); }}
          disabled={isSending}
        >
          <Icon name="add" />
        </button>
        <button
          class="menu-btn"
          title="Past Conversations (/resume)"
          onclick={() => { handleTabChange('chat'); handleResumeChat(); }}
          disabled={isSending}
        >
          <Icon name="history" />
        </button>
      </div>
    </div>
    <div class="header-right">
      <span class="workspace-badge" title="Active Workspace">
        <Icon name="folder" /> {activeWorkspaceName}
      </span>
      <span
        class="status-dot"
        class:success={!needsSetup && connectionStatus.startsWith('Connected')}
        title={connectionStatus}
      ></span>
    </div>
  </header>

  <div class="app-layout" class:narrow={isNarrow || !sidebarOpen}>
    {#if !isNarrow && sidebarOpen}
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
          {docsSuggestions}
          {workspaces}
          {activeWorkspaceId}
          {approvalRequest}
          {availableModels}
          {currentModel}
          {todos}
          {avatarUri}
          firstName={settings?.firstName}
          onSend={handleSend}
          onQueryFiles={handleQueryFiles}
          onQueryDocs={handleQueryDocs}
          onWorkspaceChange={handleWorkspaceChange}
          onApprovalRespond={handleApprovalRespond}
          onModelChange={handleModelChange}
          onPlanProceed={handlePlanProceed}
          onRewindMessage={handleRewindMessage}
          onForkMessage={handleForkMessage}
          onForkAndRewindMessage={handleForkAndRewindMessage}
          {pendingDraft}
          onDraftConsumed={() => (pendingDraft = null)}
        />
        <TokenGauge
          used={tokensUsed}
          limit={tokensLimit}
          inputTokens={tokenUsage?.inputTokens ?? 0}
          outputTokens={tokenUsage?.outputTokens ?? 0}
          cachedTokens={tokenUsage?.cachedTokens ?? 0}
          history={tokenUsage?.history ?? []}
        />
      {:else if activeTab === 'settings'}
        <SettingsPanel
          {settings}
          defaults={settingsDefaults}
          {saveStatus}
          {mcpServers}
          {docsStatuses}
          {indexStatus}
          onSave={handleSaveSettings}
          onIndexDocs={handleIndexDocs}
          onReindex={handleReindex}
          onOpenConfig={handleOpenConfig}
          onOpenGuide={handleOpenGuide}
          onRequestGitInit={handleRequestGitInit}
          onSetHitlMode={handleSetHitlMode}
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

  {#if isNarrow && sidebarOpen}
    <div
      class="drawer-backdrop"
      transition:fade={{ duration: 120 }}
      onclick={() => (sidebarOpen = false)}
      onkeydown={e => e.key === 'Enter' && (sidebarOpen = false)}
      role="button"
      tabindex="-1"
      aria-label="Close navigation"
    ></div>
    <div class="drawer" transition:fly={{ x: -240, duration: 180 }}>
      <Sidebar {activeTab} onTabChange={handleTabChange} />
    </div>
  {/if}
  {/if}
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    /* height (not min-height): scrolling must live inside .main-content,
       not on the document — otherwise the header (and its ☰ button in
       narrow mode) disappears as soon as a long page like Settings scrolls. */
    height: 100vh;
    overflow: hidden;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
    font-family: var(--vscode-font-family, ui-sans-serif, system-ui, sans-serif);
  }

  .app-header {
    display: flex;
    flex-wrap: wrap;
    row-gap: 4px;
    align-items: center;
    justify-content: space-between;
    gap: var(--jarvis-space-2);
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-panel-background);
  }

  .header-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--jarvis-space-2);
    min-width: 0;
  }

  .header-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-left: 8px;
    min-width: 0;
  }

  .app-header h1 {
    margin: 0;
    font-size: var(--jarvis-text-lg);
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 4ch;
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
    gap: var(--jarvis-space-3);
    min-width: 0;
  }

  .workspace-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: var(--jarvis-gold-dim);
    color: var(--jarvis-gold);
    border: 1px solid transparent;
    border-radius: var(--jarvis-radius-sm);
    font-size: var(--jarvis-text-xs);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: min(200px, 40vw);
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
