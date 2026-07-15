<script lang="ts">
  import type { Message, ApprovalRequest, TodoItem } from '../shared/types';
  import { marked } from 'marked';
  import Prism from 'prismjs';
  import 'prismjs/components/prism-markup';
  import 'prismjs/components/prism-css';
  import 'prismjs/components/prism-clike';
  import 'prismjs/components/prism-javascript';
  import 'prismjs/components/prism-typescript';
  import 'prismjs/components/prism-jsx';
  import 'prismjs/components/prism-tsx';
  import 'prismjs/components/prism-python';
  import 'prismjs/components/prism-rust';
  import 'prismjs/components/prism-json';
  import 'prismjs/components/prism-bash';
  import 'prismjs/components/prism-c';
  import 'prismjs/components/prism-cpp';
  import 'prismjs/components/prism-csharp';
  import 'prismjs/components/prism-go';
  import 'prismjs/components/prism-java';
  import 'prismjs/components/prism-yaml';
  import { untrack } from 'svelte';
  import { matchTrigger, filterCommands, type CommandItem } from '../shared/commands';
  import Icon from './Icon.svelte';
  import ApprovalCard from './ApprovalCard.svelte';
  import TodoList from './TodoList.svelte';
  import vscode from '../lib/vscode-api';

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
    /** Dynamic items (agents/workflows) merged into autocompletion. */
    extraCommands?: CommandItem[];
    /** Workspace file suggestions for the `@` mention. */
    fileSuggestions?: string[];
    /** Documentation sites configured (Settings > Docs) for the `@docs:` mention. */
    docsSuggestions?: string[];
    /** Selectable workspace profiles (Settings > Workspaces). */
    workspaces?: Array<{ id: string; name: string }>;
    activeWorkspaceId?: string | null;
    /** Pending HITL approval request (card shown in the chat). */
    approvalRequest?: ApprovalRequest | null;
    onSend?: (text: string) => void;
    /** Asks the backend for files matching the input. */
    onQueryFiles?: (query: string) => void;
    /** Asks the backend for documentation sources matching the input. */
    onQueryDocs?: (query: string) => void;
    onWorkspaceChange?: (id: string | null) => void;
    onApprovalRespond?: (decision: 'allow' | 'allow-session' | 'deny', feedback?: string) => void;
    availableModels?: string[];
    currentModel?: string;
    onModelChange?: (model: string) => void;
    onPlanProceed?: () => void;
    firstName?: string;
    todos?: TodoItem[];
    /** Avatar video (media/), shown in place of the icon in the "Working…" badge. */
    avatarUri?: string | null;
  }

  let {
    title = 'Chat',
    messages = [],
    isSending = false,
    showThinking = true,
    extraCommands = [],
    fileSuggestions = [],
    docsSuggestions = [],
    workspaces = [],
    activeWorkspaceId = null,
    approvalRequest = null,
    onSend = () => {},
    onQueryFiles = () => {},
    onQueryDocs = () => {},
    onWorkspaceChange = () => {},
    onApprovalRespond = () => {},
    availableModels = [],
    currentModel = '',
    onModelChange = () => {},
    onPlanProceed = () => {},
    firstName = '',
    todos = [],
    avatarUri = null
  }: Props = $props();

  let mode = $state('Automatic');

  let isSmallModel = $derived(
    currentModel.toLowerCase().includes('7b') || 
    currentModel.toLowerCase().includes('8b')
  );

  $effect(() => {
    if (isSmallModel && mode === 'Plan') {
      mode = 'Fast';
    }
  });

  let inputText = $state('');
  /** id of the plan message for which Proceed/Review was already clicked — hides the actions until a new plan arrives. */
  let dismissedPlanActionsId = $state<string | null>(null);
  let listEl: HTMLUListElement | undefined = $state();
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  // Up/Down history recall (like a shell / Claude Code CLI).
  let historyIndex = $state(-1);
  let draftBeforeHistory = $state('');
  let userHistory = $derived(messages.filter((m) => m.role === 'user').map((m) => m.content));

  // `/` command and `@` mention autocompletion.
  let showMenu = $state(false);
  let menuItems = $state<CommandItem[]>([]);
  let selectedIndex = $state(0);
  let tokenStart = $state(0);
  let acListEl: HTMLUListElement | undefined = $state();

  // Keeps the keyboard-hovered item visible in the list (scroll doesn't
  // follow the selection on its own on ArrowUp/ArrowDown otherwise).
  $effect(() => {
    void selectedIndex;
    if (!showMenu || !acListEl) return;
    acListEl.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  });

  /** Last file query sent — avoids re-requesting on every re-render. */
  let lastFileQuery: string | null = null;
  /** Last docs query sent — avoids re-requesting on every re-render. */
  let lastDocsQuery: string | null = null;

  /** File query derived from the current `@` token (`@file:src/a` → `src/a`). */
  function fileQueryFor(partial: string): string {
    return partial.startsWith('file:') ? partial.slice('file:'.length) : partial;
  }

  /** A path with spaces must be quoted to remain a single mention. */
  function fileInsert(path: string): string {
    return /\s/.test(path) ? `@file:"${path}" ` : `@file:${path} `;
  }

  function refreshMenu() {
    if (!textareaEl) return;
    const caret = textareaEl.selectionStart ?? inputText.length;
    const match = matchTrigger(inputText, caret);
    if (!match) {
      showMenu = false;
      lastFileQuery = null;
      lastDocsQuery = null;
      return;
    }
    let items = filterCommands(match, extraCommands);
    // "docs" (4 letters) is enough to disambiguate from `@Doc-Agent` (which
    // diverges at the 4th character: 's' vs '-'), so the template appears as
    // soon as `@docs` is typed, even before the `:` — otherwise accepting the
    // static generic entry would just insert `@docs:` and close the menu
    // (accept() doesn't re-trigger refreshMenu), forcing the user to type the
    // query outside the mention or to send too early.
    if (match.trigger === '@' && match.partial.toLowerCase().startsWith('docs')) {
      // Doc mention: the search is global (all indexed sources + the
      // workspace's .md files, see searchAllDocs on the backend) — there's no
      // "per site" selection. Enter directly inserts the valid format
      // `@docs:"..."` with the caret between the quotes, keeping what's
      // already typed (otherwise an unquoted multi-word query would be
      // truncated at the first space on the backend, see mentions.ts).
      const rest = match.partial.slice('docs'.length);
      const query = rest.startsWith(':') ? rest.slice(1) : '';
      if (query !== lastDocsQuery) {
        lastDocsQuery = query;
        onQueryDocs(query);
      }
      const detail = docsSuggestions.length
        ? `Searching all indexed sources: ${docsSuggestions.join(', ')}`
        : 'No indexed source (Settings > Docs)';
      const docItem: CommandItem = {
        trigger: '@',
        insert: `@docs:"${query}" `,
        label: query ? `Search: "${query}"` : 'Search the docs',
        detail,
        caretBack: 2
      };
      items = [...items.filter(i => i.insert !== '@docs:'), docItem];
    } else if (match.trigger === '@') {
      // File mention: workspace files are offered directly below the @
      // commands.
      const query = fileQueryFor(match.partial);
      if (query !== lastFileQuery) {
        lastFileQuery = query;
        onQueryFiles(query);
      }
      const q = query.toLowerCase();
      const fileItems: CommandItem[] = fileSuggestions
        .filter(p => !q || p.toLowerCase().includes(q))
        .map(p => ({ trigger: '@' as const, insert: fileInsert(p), label: p, detail: 'Workspace file' }));
      // Dedupes in case a path is already present.
      const seen = new Set(items.map(i => i.insert));
      items = [...items, ...fileItems.filter(i => !seen.has(i.insert))];
    }
    if (items.length === 0) {
      showMenu = false;
      return;
    }
    menuItems = items;
    tokenStart = match.tokenStart;
    selectedIndex = Math.min(selectedIndex, items.length - 1);
    showMenu = true;
  }

  function handleInput() {
    if (historyIndex !== -1) historyIndex = -1;
    selectedIndex = 0;
    refreshMenu();
  }

  // Suggestions arrive asynchronously: refresh the open menu.
  // untrack: the effect must depend ONLY on fileSuggestions/docsSuggestions (refreshMenu
  // reads/writes selectedIndex & co, which would re-trigger the effect).
  $effect(() => {
    void fileSuggestions;
    void docsSuggestions;
    untrack(() => refreshMenu());
  });

  function accept(item: CommandItem) {
    const caret = textareaEl?.selectionStart ?? inputText.length;
    inputText = inputText.slice(0, tokenStart) + item.insert + inputText.slice(caret);
    showMenu = false;
    const newCaret = tokenStart + item.insert.length - (item.caretBack ?? 0);
    // Repositions the caret after insertion (on the next tick).
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.setSelectionRange(newCaret, newCaret);
      }
    });
  }

  /** Common aliases to the Prism grammar names registered above. */
  const PRISM_LANG_ALIASES: Record<string, string> = {
    js: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    py: 'python',
    py3: 'python',
    rs: 'rust',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    console: 'bash',
    html: 'markup',
    xml: 'markup',
    svg: 'markup',
    svelte: 'markup',
    vue: 'markup',
    yml: 'yaml',
    'c++': 'cpp',
    cs: 'csharp',
    'c#': 'csharp'
  };

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Syntax highlighting for code blocks via Prism (spec §8.1). */
  function highlightCode(code: string, lang: string): string {
    const key = lang.toLowerCase();
    const grammarName = PRISM_LANG_ALIASES[key] ?? key;
    const grammar = grammarName ? Prism.languages[grammarName] : undefined;
    if (!grammar) return escapeHtml(code);
    try {
      return Prism.highlight(code, grammar, grammarName);
    } catch {
      return escapeHtml(code);
    }
  }

  const renderer = new marked.Renderer();
  renderer.code = (code: string, infostring: string | undefined, _escaped: boolean) => {
    const lang = (infostring || '').trim().split(/\s+/)[0] ?? '';
    const body = code.replace(/\n$/, '');
    const highlighted = lang ? highlightCode(body, lang) : escapeHtml(body);
    const cls = lang ? ` class="language-${lang.toLowerCase()}"` : '';
    return `<pre><code${cls}>${highlighted}\n</code></pre>\n`;
  };

  marked.setOptions({ breaks: true, gfm: true, renderer });

  interface Segment {
    type: 'markdown' | 'thinking';
    content: string;
  }

  /** Splits <thinking> blocks from the rest (spec §2.1 — chain of thought). */
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

  /** One-click code copy and file link interception. */
  function handleListClick(event: MouseEvent) {
    const target = event.target as HTMLElement;

    // Intercept clicks on file:// links to open the file in VS Code
    const link = target.closest('a');
    if (link && listEl?.contains(link)) {
      const href = link.getAttribute('href');
      if (href && href.startsWith('file://')) {
        event.preventDefault();
        vscode?.postMessage({ type: 'openFile', path: href });
        return;
      }
    }

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

  function isCaretOnFirstLine(): boolean {
    const caret = textareaEl?.selectionStart ?? 0;
    return inputText.lastIndexOf('\n', caret - 1) === -1;
  }

  function isCaretOnLastLine(): boolean {
    const caret = textareaEl?.selectionEnd ?? inputText.length;
    return inputText.indexOf('\n', caret) === -1;
  }

  /** Steps through `userHistory`, returning false (no-op) when there's nothing further to recall. */
  function recallHistory(direction: 'up' | 'down'): boolean {
    if (direction === 'up') {
      if (userHistory.length === 0 || historyIndex === 0) return false;
      if (historyIndex === -1) {
        draftBeforeHistory = inputText;
        historyIndex = userHistory.length - 1;
      } else {
        historyIndex--;
      }
      inputText = userHistory[historyIndex];
    } else {
      if (historyIndex === -1) return false;
      if (historyIndex < userHistory.length - 1) {
        historyIndex++;
        inputText = userHistory[historyIndex];
      } else {
        historyIndex = -1;
        inputText = draftBeforeHistory;
      }
    }
    // Repositions the caret at the end (on the next tick).
    queueMicrotask(() => {
      if (textareaEl) {
        textareaEl.focus();
        textareaEl.setSelectionRange(inputText.length, inputText.length);
      }
    });
    return true;
  }

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
    } else if (event.key === 'ArrowUp' && isCaretOnFirstLine() && recallHistory('up')) {
      event.preventDefault();
      return;
    } else if (event.key === 'ArrowDown' && isCaretOnLastLine() && recallHistory('down')) {
      event.preventDefault();
      return;
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
    historyIndex = -1;
    draftBeforeHistory = '';
    onSend(`${mode}|${text}`);
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
      {#if firstName}
        <h3 style="margin-top: 0; color: var(--vscode-editor-foreground);">Hello {firstName}</h3>
      {/if}
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
            class:inline-edit={message.kind === 'inline'}
          >
            {#if message.badges?.length}
              <div class="badges">
                {#each message.badges as badge}
                  <span class="badge {badge.variant ?? 'info'}" class:wavelight={isSending && badge.label === 'Thinking' && message.id === messages[messages.length - 1].id}>
                    <Icon name={BADGE_ICONS[badge.variant ?? 'info'] ?? 'info'} size={11} />
                    {badge.label}
                  </span>
                {/each}
              </div>
            {/if}

            {#if message.processSteps && message.processSteps.length > 0}
              <details class="thinking-details" open={isSending && message.id === messages[messages.length - 1].id}>
                <summary>
                  <Icon name="lightbulb" size={12} /> Agent Process <span class="expand-icon"><Icon name="chevron-down" size={12} /></span>
                </summary>
                <div class="process-steps">
                  {#each message.processSteps as step (step.id)}
                    <div class="process-step {step.kind}">
                      {#if step.badges?.length}
                        <div class="badges">
                          {#each step.badges as badge}
                            <span class="badge {badge.variant ?? 'info'}">
                              <Icon name={BADGE_ICONS[badge.variant ?? 'info'] ?? 'info'} size={11} />
                              {badge.label}
                            </span>
                          {/each}
                        </div>
                      {/if}
                      {#if step.content}
                        <div class="thinking-block">{step.content}</div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </details>
            {/if}

            {#if message.role === 'assistant'}
              {#if message.content}
                {#each segment(message.content) as seg}
                  {#if seg.type === 'thinking'}
                    {#if showThinking}
                      <details class="thinking-details" open={isSending && message.id === messages[messages.length - 1].id}>
                        <summary><Icon name="lightbulb" size={12} /> Thinking process <span class="expand-icon"><Icon name="chevron-down" size={12} /></span></summary>
                        <div class="thinking-block">{seg.content}</div>
                      </details>
                    {/if}
                  {:else}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -- Markdown rendu localement, CSP stricte du webview -->
                    <div class="markdown">{@html render(seg.content)}</div>
                  {/if}
                {/each}
              {/if}

              {#if isSending && message.id === messages[messages.length - 1].id}
                <p class="pending">
                  <span class="badge info wavelight">
                    {#if avatarUri}
                      <video class="avatar" src={avatarUri} autoplay loop muted playsinline></video>
                    {:else}
                      <Icon name="cpu" size={11} />
                    {/if}
                    Working...
                  </span>
                </p>
              {/if}

              {#if message.kind === 'plan' && message.id === messages[messages.length - 1].id && dismissedPlanActionsId !== message.id}
                <div class="plan-actions">
                  <button class="btn-primary" onclick={() => { dismissedPlanActionsId = message.id; onPlanProceed(); }} disabled={isSending}>
                    <Icon name="check" size={14} /> Proceed
                  </button>
                  <button class="btn-secondary" onclick={() => { dismissedPlanActionsId = message.id; textareaEl?.focus(); }} disabled={isSending}>
                    <Icon name="edit" size={14} /> Review
                  </button>
                </div>
              {/if}
            {:else if message.kind !== 'tool' && message.kind !== 'step' && message.kind !== 'thinking'}
              <p>{message.content}</p>
            {/if}
          </li>
        {/if}
      {/each}
    </ul>
  {/if}

  {#if approvalRequest}
    <ApprovalCard request={approvalRequest} onRespond={onApprovalRespond} />
  {/if}

  <TodoList items={todos} />

  <div class="controls-row">
    <select class="mode-select" bind:value={mode}>
      <option value="Automatic">Automatic</option>
      <option value="Fast">Fast</option>
      <option value="Plan" disabled={isSmallModel}>Plan</option>
    </select>
    {#if availableModels.length > 0}
      <select class="model-select" value={currentModel} onchange={e => onModelChange((e.target as HTMLSelectElement).value)}>
        {#each availableModels as mod (mod)}
          <option value={mod}>{mod}</option>
        {/each}
      </select>
    {/if}
  </div>

  <div class="input-row">
    {#if mode === 'Plan' && messages.length > 0 && messages[messages.length - 1].kind === 'plan' && !isSending}
      <div class="review-indicator">
        <Icon name="edit" size={12} />
        <span>Review mode: your instructions will modify the current plan.</span>
      </div>
    {/if}
    <div class="input-actions">
      <div class="input-wrap">
        {#if showMenu && menuItems.length > 0}
          <ul class="autocomplete" role="listbox" bind:this={acListEl}>
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
          placeholder="Ask anything… (@ to mention, / for action)"
          rows={2}
          disabled={isSending}
          bind:this={textareaEl}
          bind:value={inputText}
          oninput={handleInput}
          onkeydown={handleKeydown}
          onblur={() => (showMenu = false)}
        ></textarea>
      </div>
      {#if isSending}
        <button
          class="send-btn stop-btn"
          title="Stop generation"
          aria-label="Stop"
          onclick={() => vscode.postMessage({ type: 'cancelRequest' })}
        >
          <Icon name="square" size={12} />
        </button>
      {:else}
        <button
          class="send-btn"
          title="Send"
          aria-label="Send"
          onclick={submit}
          disabled={!inputText.trim()}
        >
          <Icon name="send" size={15} />
        </button>
      {/if}
    </div>
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
    min-height: 0;
  }

  .message {
    min-width: 0;
  }

  /* User message: compact bubble right-aligned (Le Chat style). */
  .message.user {
    align-self: flex-end;
    max-width: 85%;
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    border-radius: var(--jarvis-radius-lg);
    border-bottom-right-radius: var(--jarvis-radius-sm);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-editorWidget-border);
  }

  /* Assistant reply: full width, no bubble. */
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

  /* Ctrl+K prompt (inline edit): same user bubble, distinct background + gold accent. */
  .message.user.inline-edit {
    background: color-mix(in srgb, var(--jarvis-gold) 8%, var(--vscode-input-background));
    border-left: 2px solid var(--jarvis-gold);
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

  .avatar {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    object-fit: cover;
  }

  p {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Chain of thought: distinct background, monospace (spec §2.1) */
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
    user-select: none;
  }

  .expand-icon {
    display: inline-flex;
    opacity: 0.6;
    transition: transform 0.2s ease;
  }

  .thinking-details[open] .expand-icon {
    transform: rotate(180deg);
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

  .process-steps {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding-left: 8px;
    border-left: 2px solid var(--vscode-editorWidget-border);
  }

  .process-step.tool,
  .process-step.step {
    padding: 2px 0;
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
    content: 'copy';
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
    content: '✓ copied';
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
    color: var(--jarvis-gold);
  }

  /* Prism syntax highlighting (spec §8.1) — Iron Man palette (gold/red) on the editor background. */
  .markdown :global(.token.comment),
  .markdown :global(.token.prolog),
  .markdown :global(.token.doctype),
  .markdown :global(.token.cdata) {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }

  .markdown :global(.token.keyword),
  .markdown :global(.token.atrule),
  .markdown :global(.token.important) {
    color: var(--jarvis-gold);
  }

  .markdown :global(.token.string),
  .markdown :global(.token.char),
  .markdown :global(.token.attr-value) {
    color: #d69a5c;
  }

  .markdown :global(.token.function),
  .markdown :global(.token.class-name) {
    color: #e08a5f;
  }

  .markdown :global(.token.number),
  .markdown :global(.token.boolean),
  .markdown :global(.token.constant),
  .markdown :global(.token.symbol) {
    color: #d9b36c;
  }

  .markdown :global(.token.tag),
  .markdown :global(.token.selector),
  .markdown :global(.token.deleted) {
    color: var(--jarvis-accent-hover);
  }

  .markdown :global(.token.attr-name),
  .markdown :global(.token.property),
  .markdown :global(.token.builtin),
  .markdown :global(.token.inserted) {
    color: #c9a86a;
  }

  .markdown :global(.token.operator),
  .markdown :global(.token.entity),
  .markdown :global(.token.punctuation) {
    color: var(--vscode-descriptionForeground);
  }

  .markdown :global(.token.regex),
  .markdown :global(.token.variable) {
    color: #e8b84b;
  }

  .markdown :global(.token.url) {
    color: var(--jarvis-gold);
    text-decoration: underline;
  }

  .markdown :global(.token.bold) {
    font-weight: 600;
  }

  .markdown :global(.token.italic) {
    font-style: italic;
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

  .wavelight {
    position: relative;
    overflow: hidden;
  }

  .wavelight::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 50%;
    height: 100%;
    background: linear-gradient(90deg, transparent, rgba(232, 184, 75, 0.22), transparent);
    animation: wave 2s infinite linear;
    pointer-events: none;
  }

  @keyframes wave {
    0% { left: -100%; }
    100% { left: 200%; }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .controls-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jarvis-space-2);
    margin-bottom: var(--jarvis-space-2);
  }

  .mode-select, .model-select {
    flex: 1 1 45%;
    padding: 3px 8px;
    background: var(--vscode-dropdown-background, var(--vscode-input-background));
    color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
    border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border));
    border-radius: var(--jarvis-radius-sm);
    font-size: var(--jarvis-text-xs);
    min-width: 0;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-2);
  }

  .input-actions {
    display: flex;
    gap: 0.5rem;
    align-items: flex-end;
  }

  .review-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-editorWidget-background);
    padding: 4px 8px;
    border-radius: 4px;
    border-left: 2px solid var(--jarvis-gold);
    align-self: flex-start;
  }

  .input-wrap {
    position: relative;
    flex: 1;
    display: flex;
  }
  .btn-primary, .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.2s ease;
  }
  .btn-primary {
    background: var(--jarvis-gold);
    color: #241a05;
  }
  .btn-primary:hover:not(:disabled) {
    background: var(--jarvis-gold-hover);
  }
  .btn-secondary {
    background: var(--vscode-button-secondaryBackground, #5f6a79);
    color: var(--vscode-button-secondaryForeground, #ffffff);
  }
  .btn-secondary:hover:not(:disabled) {
    background: var(--vscode-button-secondaryHoverBackground, #4c5561);
  }
  .btn-primary:disabled, .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .plan-actions {
    display: flex;
    gap: var(--jarvis-space-2);
    margin-top: var(--jarvis-space-3);
    margin-bottom: var(--jarvis-space-2);
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
    background: var(--jarvis-gold-dim);
    color: var(--vscode-editor-foreground);
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
    align-self: flex-end;
    background: var(--jarvis-gold);
    color: #241a05;
    border: none;
    border-radius: var(--jarvis-radius-md);
    padding: var(--jarvis-space-2) var(--jarvis-space-3);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 36px;
  }
  .send-btn:hover:not(:disabled) {
    background: var(--jarvis-gold-hover);
  }
  .send-btn.stop-btn {
    background: var(--vscode-errorForeground);
    color: var(--vscode-editor-background);
  }
  .send-btn.stop-btn:hover {
    opacity: 0.8;
  }
  .send-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
