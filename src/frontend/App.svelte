<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import ChatPanel from './components/ChatPanel.svelte';
  import TokenGauge from './components/TokenGauge.svelte';
  import CheckpointPanel from './components/CheckpointPanel.svelte';
  import { APP_NAME } from './shared/constants';
  import type { Message } from './shared/types';
  import vscode from './lib/vscode-api';

  type Tab = 'chat' | 'checkpoints';

  interface Checkpoint {
    id: string;
    ref: string;
    type: string;
    description: string;
    timestamp: string;
  }

  let connectionStatus = $state('Connexion en cours...');
  let tokensUsed = $state(0);
  let tokensLimit = $state(32768);
  let messages = $state<Message[]>([]);
  let isSending = $state(false);
  let activeTab = $state<Tab>('chat');
  let checkpoints = $state<Checkpoint[]>([]);

  function appendToLastAssistant(text: string) {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      messages = [
        ...messages.slice(0, -1),
        { ...last, content: last.content + text }
      ];
    } else {
      messages = [
        ...messages,
        { id: crypto.randomUUID(), role: 'assistant', content: text, timestamp: Date.now() }
      ];
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
      checkpoints?: Checkpoint[];
    };

    switch (msg.type) {
      case 'status':
        if (msg.text) connectionStatus = msg.text;
        break;
      case 'tokens':
        if (msg.tokensUsed !== undefined) tokensUsed = msg.tokensUsed;
        if (msg.tokensLimit !== undefined) tokensLimit = msg.tokensLimit;
        break;
      case 'chatStart':
        messages = [
          ...messages,
          { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: Date.now() }
        ];
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
        appendToLastAssistant(`\n❌ Erreur: ${msg.error ?? 'inconnue'}`);
        isSending = false;
        break;
      // Legacy single-shot message (kept for backward compatibility)
      case 'chatMessage':
        if (msg.text) {
          messages = [
            ...messages,
            { id: crypto.randomUUID(), role: 'assistant', content: msg.text, timestamp: Date.now() }
          ];
          isSending = false;
        }
        break;
      case 'checkpoints':
        checkpoints = msg.checkpoints ?? [];
        break;
    }
  }

  function handleSend(text: string) {
    if (!text.trim() || isSending) return;
    messages = [
      ...messages,
      { id: crypto.randomUUID(), role: 'user', content: text.trim(), timestamp: Date.now() }
    ];
    isSending = true;
    vscode?.postMessage({ type: 'chatMessage', text: text.trim() });
  }

  function handleTabChange(tab: string) {
    activeTab = tab as Tab;
    if (tab === 'checkpoints') {
      vscode?.postMessage({ type: 'listCheckpoints' });
    }
  }

  function handleRollback(ref: string) {
    vscode?.postMessage({ type: 'rollback', ref });
  }

  function handleRefreshCheckpoints() {
    vscode?.postMessage({ type: 'listCheckpoints' });
  }
</script>

<svelte:window onmessage={onWindowMessage} />

<div class="app-shell">
  <header class="app-header">
    <h1>{APP_NAME}</h1>
    <span class="status" class:success={connectionStatus.includes('✅')}>{connectionStatus}</span>
  </header>

  <div class="app-layout">
    <Sidebar {activeTab} onTabChange={handleTabChange} />
    <main class="main-content">
      {#if activeTab === 'chat'}
        <ChatPanel {messages} {isSending} onSend={handleSend} />
        <TokenGauge used={tokensUsed} limit={tokensLimit} />
      {:else if activeTab === 'checkpoints'}
        <CheckpointPanel
          {checkpoints}
          onRollback={handleRollback}
          onRefresh={handleRefreshCheckpoints}
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

  @media (max-width: 640px) {
    .app-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
