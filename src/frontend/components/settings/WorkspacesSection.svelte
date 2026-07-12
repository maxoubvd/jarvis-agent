<script lang="ts">
  import type { WorkspaceProfile } from '../../shared/types';
  import Icon from '../Icon.svelte';
  import Toggle from '../Toggle.svelte';

  interface Props {
    items?: WorkspaceProfile[];
    indexStatus?: { indexing: boolean; fileCount: number } | null;
    onChange?: (next: WorkspaceProfile[]) => void;
    onReindex?: () => void;
  }

  let {
    items = [],
    indexStatus = null,
    onChange = () => {},
    onReindex = () => {}
  }: Props = $props();

  /** Expanded cards (a new workspace opens in edit mode). */
  let expanded = $state<Record<string, boolean>>({});

  function addWorkspace() {
    const id = crypto.randomUUID();
    expanded[id] = true;
    onChange([
      ...items,
      {
        id,
        name: 'My workspace',
        instructions: '',
        enabled: true
      }
    ]);
  }

  function removeWorkspace(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function patch(index: number, partial: Partial<WorkspaceProfile>) {
    onChange(items.map((w, i) => (i === index ? { ...w, ...partial } : w)));
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="folder" size={14} /> Workspaces</h3>
    <button class="j-btn" onclick={addWorkspace}><Icon name="add" size={13} /> Add workspace</button>
  </div>

  <p class="j-hint">
    A workspace is a <strong>context profile</strong>, not a folder switcher: its instructions
    are injected into the system prompt when selected in the Chat tab. It does <strong>not</strong>
    change which files the agent can access — that is always the folder currently open in VS Code.
  </p>

  {#if items.length === 0}
    <div class="j-empty">No workspace profile yet.</div>
  {/if}

  {#each items as workspace, index (workspace.id)}
    <div class="j-card" class:disabled={!workspace.enabled}>
      <div class="j-row">
        <button
          class="j-expand"
          title={expanded[workspace.id] ? 'Collapse' : 'Edit workspace'}
          onclick={() => (expanded[workspace.id] = !expanded[workspace.id])}
        >
          <Icon name={expanded[workspace.id] ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        <span class="j-title j-grow">{workspace.name.trim() || '(unnamed workspace)'}</span>
        <Toggle
          checked={workspace.enabled}
          label="Enabled"
          onchange={on => patch(index, { enabled: on })}
        />
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removeWorkspace(index)}>
          <Icon name="trash" size={13} />
        </button>
      </div>

      {#if expanded[workspace.id]}
      <label class="j-field">
        <span>Name</span>
        <input
          class="j-input"
          placeholder="Name"
          value={workspace.name}
          oninput={e => patch(index, { name: (e.target as HTMLInputElement).value })}
        />
      </label>

      <label class="j-field">
        <span>Instructions</span>
        <textarea
          class="j-textarea"
          rows="6"
          placeholder="Markdown instructions injected into the system prompt — a project instructions file (stack, conventions, commands, constraints…)"
          value={workspace.instructions}
          oninput={e => patch(index, { instructions: (e.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>

      <div class="j-row j-end">
        <button class="j-btn j-btn-primary" onclick={() => (expanded[workspace.id] = false)}>
          <Icon name="check" size={13} /> Validate
        </button>
      </div>
      {/if}

      <div class="indexation">
        <span class="indexation-title">Indexation</span>
        <div class="j-row">
          {#if indexStatus?.indexing}
            <span class="status indexing"><Icon name="sync" size={12} /> Indexing…</span>
          {:else if indexStatus}
            <span class="status ok">
              <Icon name="check" size={12} /> {indexStatus.fileCount} file{indexStatus.fileCount === 1 ? '' : 's'} indexed
            </span>
          {:else}
            <span class="status">Index status unknown</span>
          {/if}
          <button class="j-btn" disabled={indexStatus?.indexing} onclick={() => onReindex()}>
            <Icon name="sync" size={13} /> Re-index
          </button>
        </div>
        <span class="j-hint">Indexing covers the folder currently open in VS Code.</span>
      </div>
    </div>
  {/each}
</div>

<style>
  .group-head {
    justify-content: space-between;
  }

  h3 {
    margin: 0;
    font-size: var(--jarvis-text-md);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-1);
  }

  p {
    margin: 0;
  }

  .indexation {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-1);
    border-top: 1px dashed var(--vscode-editorWidget-border);
    padding-top: var(--jarvis-space-2);
  }

  .indexation-title {
    font-size: var(--jarvis-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-descriptionForeground);
  }

  .status.ok {
    color: var(--vscode-terminal-ansiGreen);
  }

  .status.indexing {
    color: var(--jarvis-gold);
  }
</style>
