<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    /** Whether a checkpoint is linked to this message — gates Rewind & Fork+Rewind. */
    hasCheckpoint?: boolean;
    /** True while a turn is in flight — gates every action. */
    disabled?: boolean;
    onRewind?: () => void;
    onFork?: () => void;
    onForkAndRewind?: () => void;
  }

  let {
    hasCheckpoint = false,
    disabled = false,
    onRewind = () => {},
    onFork = () => {},
    onForkAndRewind = () => {}
  }: Props = $props();

  let open = $state(false);
  let rootEl = $state<HTMLElement | null>(null);

  function toggle() {
    open = !open;
  }

  function choose(action: () => void) {
    open = false;
    action();
  }

  $effect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootEl && !rootEl.contains(e.target as Node)) open = false;
    };
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open = false;
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeydown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeydown);
    };
  });
</script>

<div class="msg-actions" bind:this={rootEl}>
  <button
    class="j-expand msg-actions-trigger"
    title="Rewind / fork from this message"
    aria-label="Rewind / fork from this message"
    onclick={toggle}
    {disabled}
  >
    <Icon name="kebab" size={13} />
  </button>

  {#if open}
    <div class="msg-actions-menu" role="menu">
      <button
        class="msg-actions-item"
        role="menuitem"
        disabled={!hasCheckpoint}
        title={hasCheckpoint ? undefined : 'No file changes to rewind — this turn ran no tools'}
        onclick={() => choose(onRewind)}
      >
        <Icon name="rewind" size={13} /> Rewind code from this message
      </button>
      <button class="msg-actions-item" role="menuitem" onclick={() => choose(onFork)}>
        <Icon name="branch" size={13} /> Fork conversation from this message
      </button>
      <button
        class="msg-actions-item"
        role="menuitem"
        disabled={!hasCheckpoint}
        title={hasCheckpoint ? undefined : 'No file changes to rewind — this turn ran no tools'}
        onclick={() => choose(onForkAndRewind)}
      >
        <Icon name="branch" size={13} /><Icon name="rewind" size={13} /> Fork &amp; rewind code
      </button>
    </div>
  {/if}
</div>

<style>
  .msg-actions {
    position: absolute;
    top: 2px;
    right: 2px;
  }

  .msg-actions-trigger {
    opacity: 0;
    background: var(--vscode-input-background);
    transition: opacity var(--jarvis-transition), background var(--jarvis-transition);
  }

  :global(.message.user:hover) .msg-actions-trigger,
  :global(.message.user:focus-within) .msg-actions-trigger,
  .msg-actions-trigger:focus-visible {
    opacity: 1;
  }

  .msg-actions-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    min-width: 15rem;
    padding: var(--jarvis-space-1);
    background: var(--vscode-menu-background, var(--vscode-editorWidget-background));
    color: var(--vscode-menu-foreground, var(--vscode-editor-foreground));
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-md);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
  }

  .msg-actions-item {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    padding: var(--jarvis-space-2);
    background: transparent;
    color: inherit;
    border: none;
    border-radius: var(--jarvis-radius-sm);
    cursor: pointer;
    font-size: var(--jarvis-text-sm);
    font-family: inherit;
    text-align: left;
    white-space: nowrap;
  }

  .msg-actions-item:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  .msg-actions-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
