<script lang="ts">
  import type { Message } from '../shared/types';
  import { marked } from 'marked';
  import { matchTrigger, filterCommands, type CommandItem } from '../shared/commands';

  interface Props {
    title?: string;
    messages?: Message[];
    isSending?: boolean;
    showThinking?: boolean;
    /** Items dynamiques (agents/workflows) fusionnés dans l'autocomplétion. */
    extraCommands?: CommandItem[];
    onSend?: (text: string) => void;
  }

  let {
    title = 'Chat',
    messages = [],
    isSending = false,
    showThinking = true,
    extraCommands = [],
    onSend = () => {}
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
                  <span class="badge {badge.variant ?? 'info'}">{badge.icon} {badge.label}</span>
                {/each}
              </div>
            {/if}

            {#if message.kind === 'thinking'}
              <div class="thinking-block">{message.content}</div>
            {:else if message.role === 'assistant'}
              <span class="role">Assistant</span>
              {#if message.content}
                {#each segment(message.content) as seg}
                  {#if seg.type === 'thinking'}
                    {#if showThinking}
                      <details class="thinking-details" open>
                        <summary>🧠 Thinking</summary>
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
              <span class="role">You</span>
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
    <button class="send-btn" onclick={submit} disabled={isSending || !inputText.trim()}>
      Send
    </button>
  </div>
</section>

<style>
  .chat-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.75rem;
    background: var(--vscode-editor-background);
    min-height: 200px;
    gap: 0.75rem;
  }

  header h2 {
    margin: 0;
    font-size: 1rem;
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
    gap: 0.75rem;
    overflow-y: auto;
    max-height: 55vh;
  }

  .message {
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: var(--vscode-editorWidget-background);
  }

  .message.user {
    border-left: 3px solid var(--vscode-button-background);
  }

  .message.assistant {
    border-left: 3px solid var(--vscode-terminal-ansiGreen);
  }

  .message.tool {
    border-left: 3px solid var(--vscode-terminal-ansiBlue);
    font-size: 0.85rem;
  }

  .message.step {
    border-left: 3px solid var(--vscode-terminal-ansiMagenta);
    font-size: 0.85rem;
  }

  .message.thinking-msg {
    border-left: 3px solid var(--vscode-descriptionForeground);
    padding: 0.5rem 0.75rem;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.4rem;
  }

  .badge {
    font-size: 0.72rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    border: 1px solid var(--vscode-editorWidget-border);
    background: var(--vscode-editor-background);
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

  .role {
    display: block;
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
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
    font-size: 0.78rem;
    color: var(--vscode-descriptionForeground);
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
    content: '📋 copier';
    position: absolute;
    top: 0.3rem;
    right: 0.5rem;
    font-size: 0.68rem;
    color: var(--vscode-descriptionForeground);
    opacity: 0;
    transition: opacity 0.15s;
  }

  .markdown :global(pre:hover::after) {
    opacity: 1;
  }

  .markdown :global(pre.copied::after) {
    content: '✅ copié';
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
    resize: none;
    padding: 0.6rem 0.75rem;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
    border-radius: 0.5rem;
    font-family: var(--vscode-font-family, inherit);
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .input:focus {
    outline: 1px solid var(--vscode-focusBorder);
  }

  .input:disabled {
    opacity: 0.6;
  }

  .send-btn {
    padding: 0.6rem 1rem;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 0.5rem;
    font-size: 0.9rem;
    cursor: pointer;
    white-space: nowrap;
  }

  .send-btn:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
