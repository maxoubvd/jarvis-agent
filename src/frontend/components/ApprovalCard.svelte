<script lang="ts">
  import type { ApprovalRequest } from '../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    request: ApprovalRequest;
    onRespond?: (decision: 'allow' | 'allow-session' | 'deny', feedback?: string) => void;
  }

  let { request, onRespond = () => {} }: Props = $props();

  /** Denying opens a field for instructions sent back to the agent. */
  let denying = $state(false);
  let feedback = $state('');
  /** Button container (scopes keyboard navigation to this card). */
  let actionsEl = $state<HTMLElement | null>(null);

  function deny() {
    onRespond('deny', feedback.trim() || undefined);
  }

  // Auto-focus the first button so arrow keys work as soon as it's shown.
  // (In "deny" mode, the autofocus textarea takes the focus instead.)
  $effect(() => {
    void request.id; // re-focus on every new request
    if (!denying) (actionsEl?.querySelector('.j-btn') as HTMLElement | null)?.focus();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (!actionsEl) return;
    const focusable = Array.from(actionsEl.querySelectorAll('.j-btn')) as HTMLElement[];
    if (focusable.length === 0) return;
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusable[(currentIndex + 1) % focusable.length]?.focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusable[currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1]?.focus();
    }
  }
</script>

<div class="approval" role="alertdialog" aria-label="Approval required">
  <div class="head">
    <Icon name="warning" size={14} />
    <span class="title">Jarvis needs your approval</span>
  </div>
  <div class="description">{request.description}</div>
  {#if request.detail}
    <pre class="detail">{request.detail}</pre>
  {/if}

  {#if !denying}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="actions" bind:this={actionsEl} onkeydown={handleKeydown}>
      <button class="j-btn j-btn-primary" onclick={() => onRespond('allow')}>
        <Icon name="check" size={13} /> Allow
      </button>
      <button class="j-btn" onclick={() => onRespond('allow-session')}>
        Allow for this session
      </button>
      <button class="j-btn j-btn-danger" onclick={() => (denying = true)}>
        <Icon name="close" size={13} /> Deny…
      </button>
    </div>
  {:else}
    <label class="j-field">
      <span>Tell the agent what to do instead (optional)</span>
      <!-- svelte-ignore a11y_autofocus -->
      <textarea
        class="j-textarea"
        rows="2"
        autofocus
        bind:value={feedback}
        placeholder="e.g. Don't run the tests yet — fix the import in src/app.ts first."
        onkeydown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            deny();
          }
        }}
      ></textarea>
    </label>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="actions" bind:this={actionsEl} onkeydown={handleKeydown}>
      <button class="j-btn j-btn-danger" onclick={deny}>Send denial</button>
      <button class="j-btn" onclick={() => { denying = false; feedback = ''; }}>Back</button>
    </div>
  {/if}
</div>

<style>
  .approval {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-2);
    padding: var(--jarvis-space-3);
    border: 1px solid var(--vscode-inputValidation-warningBorder, var(--jarvis-gold));
    border-left: 3px solid var(--jarvis-gold);
    border-radius: var(--jarvis-radius-md);
    background: var(--vscode-inputValidation-warningBackground, var(--jarvis-gold-dim));
    flex-shrink: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    font-weight: 600;
    font-size: var(--jarvis-text-sm);
  }

  .description {
    font-size: var(--jarvis-text-md);
  }

  .detail {
    margin: 0;
    padding: var(--jarvis-space-2);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--jarvis-text-xs);
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12));
    border-radius: var(--jarvis-radius-sm);
    max-height: 8rem;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--jarvis-space-2);
  }
</style>
