<script lang="ts">
  import type { Message } from '../shared/types';
  import { marked } from 'marked';
  import { matchTrigger, filterCommands, type CommandItem } from '../shared/commands';
  import Icon from './Icon.svelte';

  const BADGE_ICONS: Record<string, string> = {
    success: 'check',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };

  interface Props {
    title?: string;
    messages?: Message[];
    isSending?: boolean;
    showThinking?: boolean;
    /** Items dynamiques (agents/workflows) fusionnés dans l'autocomplétion. */
    extraCommands?: CommandItem[];
    /** Profils de workspace sélectionnables (Settings > Workspaces). */
    workspaces?: Array<{ id: string; name: string }>;
    activeWorkspaceId?: string | null;
    onSend?: (text: string) => void;
    onWorkspaceChange?: (id: string | null) => void;
  }

  let {
    title = 'Chat',
    messages = [],
    isSending = false,
    showThinking = true,
    extraCommands = [],
    workspaces = [],
    activeWorkspaceId = null,
    onSend = () => {},
    onWorkspaceChange = () => {}
  }: Props = $props();

  let inputText = $state('');
  let listEl: HTMLUListElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // Autocomplétion des commandes `/` et mentions `@`.
  let showMenu = $state(false);
  let menuItems = $state<CommandItem[]>([]);
  let selectedIndex = $state(0);
  let tokenStart = $state(0);

  function refreshMenu() {
    if (!textareaEl) return;
    const caret = textareaEl.selectionStart ?? inputText.length;
    const match = matchTrigger(inputText, caret);
    if (!match) {
      showMenu = false;
      return;
    }
    const items = filterCommands(match, extraCommands);
    if (items.length === 0) {
      showMenu = false;
      return;
    }
    menuItems = items;
    tokenStart = match.tokenStart;
    selectedIndex = 0;
    showMenu = true;
  }

  function handleInput() {
    refreshMenu();
  }

  function accept(item: CommandItem) {
    const caret = textareaEl?.selectionStart ?? inputText.length;
    inputText = inputText.slice(0, tokenStart) + item.insert + inputText.slice(caret);
    showMenu = false;
    const newCaret = tokenStart + item.insert.length;
    // Repositionne le caret après insertion (au prochain tick).
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.setSelectionRange(newCaret, newCaret);
      }
    });
  }

  marked.setOptions({ breaks: true, gfm: true });

  interface Segment {
    type: 'markdown' | 'thinking';
    content: string;
  }

  /** Sépare les blocs <thinking> du reste (spec §2.1 — chaîne de pensée). */
  function segment(content: string): Segment[] {
    const segments: Segment[] = [];
    const regex = /<thinking>([\s\S]*?)(?:<\/thinking>|$)/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'markdown', content: content.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'thinking', content: match[1].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < content.length) {
      segments.push({ type: 'markdown', content: content.slice(lastIndex) });
    }
    return segments.filter(s => s.content.trim());
  }

  function render(content: string): string {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }

  /** Copie de code en un clic : délégation sur les <pre> rendus. */
  function handleListClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const pre = target.closest('pre');
    if (!pre || !listEl?.contains(pre)) return;
    const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? '';
    navigator.clipboard?.writeText(code).then(() => {
      pre.classList.add('copied');
      setTimeout(() => pre.classList.remove('copied'), 1200);
    });
  }

  function handleListKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      handleListClick(event as unknown as MouseEvent);
    }
  }

  $effect(() => {
    if (messages.length > 0 && listEl) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  });

  function handleKeydown(event: KeyboardEvent) {
    if (showMenu && menuItems.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % menuItems.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        accept(menuItems[selectedIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        showMenu = false;
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function submit() {
    const text = inputText.trim();
    if (!text || isSending) return;
    showMenu = false;
    inputText = '';
    onSend(text);
  }
</script>

<section class="chat-panel">
  <header>
    <h2>{title}</h2>
    {#if workspaces.length > 0}
      <select
        class="workspace-select"
        title="Active workspace"
        value={activeWorkspaceId ?? ''}
        onchange={e => {
          const v = (e.target as HTMLSelectElement).value;
          onWorkspaceChange(v || null);
        }}
      >
        <option value="">No workspace</option>
        {#each workspaces as ws (ws.id)}
          <option value={ws.id}>{ws.name}</option>
        {/each}
      </select>
    {/if}
  </header>

  {#if messages.length === 0}
    <div class="empty">
      No messages yet. Send a message to get started.
      <div class="empty-hints">
        <code>/agent &lt;task&gt;</code> agentic mode ·
        <code>/tdd &lt;task&gt;</code> Auto-TDD loop ·
        <code>/workflow &lt;id&gt; &lt;task&gt;</code> ·
        <code>@QA-Agent</code>, <code>@Doc-Agent</code>… ·
        <code>@file:path</code>, <code>@docs:topic</code>
      </div>
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <ul class="messages" bind:this={listEl} onclick={handleListClick} onkeydown={handleListKeydown}>
      {#each messages as message (message.id)}
        {#if message.kind !== 'thinking' || showThinking}
          <li
            class="message"
            class:user={message.role === 'user'}
            class:assistant={message.role === 'assistant'}
            class:tool={message.kind === 'tool'}
            class:step={message.kind === 'step'}
            class:thinking-msg={message.kind === 'thinking'}
          >
            {#if message.badges?.length}
              <div class="badges">
                {#each message.badges as badge}
                  <span class="badge {badge.variant ?? 'info'}">
                    <Icon name={BADGE_ICONS[badge.variant ?? 'info'] ?? 'info'} size={11} />
                    {badge.label}
                  </span>
                {/each}
              </div>
            {/if}

            {#if message.kind === 'thinking'}
              <div class="thinking-block">{message.content}</div>
            {:else if message.role === 'assistant'}
              {#if message.content}
                {#each segment(message.content) as seg}
                  {#if seg.type === 'thinking'}
                    {#if showThinking}
                      <details class="thinking-details" open>
                        <summary><Icon name="lightbulb" size={12} /> Thinking</summary>
                        <div class="thinking-block">{seg.content}</div>
                      </details>
                    {/if}
                  {:else}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- Markdown rendu localement, CSP stricte du webview -->
                    <div class="markdown">{@html render(seg.content)}</div>
                  {/if}
                {/each}
              {:else}
                <p class="pending">…</p>
              {/if}
            {:else}
              <p>{message.content}</p>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  {/if}

  <div class="input-row">
    <div class="input-wrap">
      {#if showMenu && menuItems.length > 0}
        <ul class="autocomplete" role="listbox">
          {#each menuItems as item, i (item.insert)}
            <li
              role="option"
              aria-selected={i === selectedIndex}
              class="ac-item"
              class:selected={i === selectedIndex}
              onmousedown={e => { e.preventDefault(); accept(item); }}
              onmouseenter={() => (selectedIndex = i)}
            >
              <code class="ac-label">{item.label}</code>
              <span class="ac-detail">{item.detail}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <textarea
        class="input"
        placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
        rows={2}
        disabled={isSending}
        bind:this={textareaEl}
        bind:value={inputText}
        oninput={handleInput}
        onkeydown={handleKeydown}
        onblur={() => (showMenu = false)}
      ></textarea>
    </div>
    <button
      class="send-btn"
      title="Send"
      aria-label="Send"
      onclick={submit}
      disabled={isSending || !inputText.trim()}
    >
      <Icon name="send" size={15} />
    </button>
  </div>
</section>

<style>
  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: var(--jarvis-space-4);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-lg);
    background: var(--vscode-editor-background);
    min-height: 200px;
    gap: var(--jarvis-space-3);
    min-width: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--jarvis-space-2);
    flex-wrap: wrap;
  }

  header h2 {
    margin: 0;
    font-size: var(--jarvis-text-md);
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .workspace-select {
    padding: 3px 8px;
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
    border-radius: var(--jarvis-radius-pill);
    font-size: var(--jarvis-text-xs);
    max-width: 11rem;
    min-width: 0;
  }

  .empty {
    flex: 1;
    color: var(--vscode-descriptionForeground);
    font-size: 0.9rem;
  }

  .empty-hints {
    margin-top: 0.75rem;
    font-size: 0.78rem;
    line-height: 1.8;
  }

  .empty-hints code {
    font-family: var(--vscode-editor-font-family, monospace);
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    padding: 0.05rem 0.3rem;
    border-radius: 0.25rem;
  }

  .messages {
    flex: 1;
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-4);
    overflow-y: auto;
    max-height: 55vh;
  }

  .message {
    min-width: 0;
  }

  /* Message utilisateur : bulle compacte alignée à droite (style Le Chat). */
  .message.user {
    align-self: flex-end;
    max-width: 85%;
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    border-radius: var(--jarvis-radius-lg);
    border-bottom-right-radius: var(--jarvis-radius-sm);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-editorWidget-border);
  }

  /* Réponse assistant : pleine largeur, sans bulle. */
  .message.assistant {
    align-self: stretch;
  }

  .message.tool,
  .message.step {
    align-self: stretch;
    font-size: var(--jarvis-text-sm);
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    border-radius: var(--jarvis-radius-md);
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
  }

  .message.step {
    border-left: 2px solid var(--jarvis-gold);
  }

  .message.thinking-msg {
    align-self: stretch;
    padding: 0;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jarvis-space-1);
    margin-bottom: var(--jarvis-space-1);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--jarvis-text-xs);
    padding: 2px 8px;
    border-radius: var(--jarvis-radius-pill);
    border: 1px solid var(--vscode-editorWidget-border);
    background: var(--vscode-editor-background);
    color: var(--vscode-descriptionForeground);
  }

  .badge.success {
    border-color: var(--vscode-terminal-ansiGreen);
    color: var(--vscode-terminal-ansiGreen);
  }

  .badge.error {
    border-color: var(--vscode-terminal-ansiRed);
    color: var(--vscode-terminal-ansiRed);
  }

  .badge.warning {
    border-color: var(--vscode-terminal-ansiYellow);
    color: var(--vscode-terminal-ansiYellow);
  }

  p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Chaîne de pensée : fond distinct, monospace (spec §2.1) */
  .thinking-details {
    margin: 0.25rem 0;
  }

  .thinking-details summary {
    cursor: pointer;
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-descriptionForeground);
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .thinking-block {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.78rem;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12));
    border-radius: 0.35rem;
    padding: 0.5rem 0.6rem;
    margin-top: 0.3rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown {
    font-size: 0.9rem;
    line-height: 1.5;
    word-break: break-word;
  }

  .markdown :global(p) {
    margin: 0 0 0.5rem;
    white-space: normal;
  }

  .markdown :global(pre) {
    position: relative;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    padding: 0.6rem 0.75rem;
    border-radius: 0.4rem;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.82rem;
    cursor: copy;
  }

  .markdown :global(pre::after) {
    content: 'copier';
    position: absolute;
    top: 0.3rem;
    right: 0.5rem;
    font-size: 0.68rem;
    color: var(--vscode-descriptionForeground);
    opacity: 0;
    transition: opacity var(--jarvis-transition);
  }

  .markdown :global(pre:hover::after) {
    opacity: 1;
  }

  .markdown :global(pre.copied::after) {
    content: '✓ copié';
    color: var(--vscode-terminal-ansiGreen);
    opacity: 1;
  }

  .markdown :global(code) {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
  }

  .markdown :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .markdown :global(a) {
    color: var(--vscode-textLink-foreground);
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0.25rem 0;
    padding-left: 1.25rem;
  }

  .pending {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .input-row {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  .input-wrap {
    position: relative;
    flex: 1;
    display: flex;
  }

  .autocomplete {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 0;
    right: 0;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    max-height: 12rem;
    overflow-y: auto;
    background: var(--vscode-editorSuggestWidget-background, var(--vscode-editorWidget-background));
    border: 1px solid var(--vscode-editorSuggestWidget-border, var(--vscode-editorWidget-border));
    border-radius: 0.4rem;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    z-index: 10;
  }

  .ac-item {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.3rem 0.45rem;
    border-radius: 0.25rem;
    cursor: pointer;
  }

  .ac-item.selected {
    background: var(--vscode-editorSuggestWidget-selectedBackground, var(--vscode-list-activeSelectionBackground));
    color: var(--vscode-list-activeSelectionForeground);
  }

  .ac-label {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.82rem;
    white-space: nowrap;
  }

  .ac-detail {
    font-size: 0.75rem;
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ac-item.selected .ac-detail {
    color: inherit;
    opacity: 0.85;
  }

  .input {
    flex: 1;
    min-width: 0;
    resize: none;
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
    border-radius: var(--jarvis-radius-lg);
    font-family: var(--jarvis-font);
    font-size: var(--jarvis-text-md);
    line-height: 1.5;
    transition: border-color var(--jarvis-transition);
  }

  .input:focus {
    outline: none;
    border-color: var(--jarvis-accent);
  }

  .input:disabled {
    opacity: 0.6;
  }

  .send-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    background: var(--jarvis-accent);
    color: var(--jarvis-accent-fg);
    border: none;
    border-radius: var(--jarvis-radius-pill);
    cursor: pointer;
    transition: background var(--jarvis-transition);
  }

  .send-btn:hover:not(:disabled) {
    background: var(--jarvis-accent-hover);
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
