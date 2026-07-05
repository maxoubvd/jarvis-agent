<script lang="ts">
  import type { Message } from '../shared/types';
  import { marked } from 'marked';

  interface Props {
    title?: string;
    messages?: Message[];
    isSending?: boolean;
    onSend?: (text: string) => void;
  }

  let { title = 'Chat', messages = [], isSending = false, onSend = () => {} }: Props = $props();

  let inputText = $state('');
  let listEl: HTMLUListElement | undefined = $state();

  marked.setOptions({ breaks: true, gfm: true });

  function render(content: string): string {
    try {
      return marked.parse(content) as string;
    } catch {
      return content;
    }
  }

  $effect(() => {
    if (messages.length > 0 && listEl) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function submit() {
    const text = inputText.trim();
    if (!text || isSending) return;
    inputText = '';
    onSend(text);
  }
</script>

<section class="chat-panel">
  <header>
    <h2>{title}</h2>
  </header>

  {#if messages.length === 0}
    <div class="empty">Aucun message pour le moment. Envoyez un message pour démarrer.</div>
  {:else}
    <ul class="messages" bind:this={listEl}>
      {#each messages as message (message.id)}
        <li class="message" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'}>
          <span class="role">{message.role === 'user' ? 'Vous' : 'Jarvis'}</span>
          {#if message.role === 'assistant'}
            {#if message.content}
              <div class="markdown">{@html render(message.content)}</div>
            {:else}
              <p class="thinking">…</p>
            {/if}
          {:else}
            <p>{message.content}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <div class="input-row">
    <textarea
      class="input"
      placeholder="Votre message… (Entrée pour envoyer, Shift+Entrée pour nouvelle ligne)"
      rows={2}
      disabled={isSending}
      bind:value={inputText}
      onkeydown={handleKeydown}
    ></textarea>
    <button class="send-btn" onclick={submit} disabled={isSending || !inputText.trim()}>
      Envoyer
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
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    padding: 0.6rem 0.75rem;
    border-radius: 0.4rem;
    overflow-x: auto;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.82rem;
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

  .thinking {
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
