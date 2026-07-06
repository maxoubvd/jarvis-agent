<script lang="ts">
  import type { PromptItem } from '../../shared/types';
  import Icon from '../Icon.svelte';

  interface Props {
    items?: PromptItem[];
    onChange?: (next: PromptItem[]) => void;
  }

  let { items = [], onChange = () => {} }: Props = $props();

  const RESERVED = ['tdd', 'workflow', 'agent'];

  function update(next: PromptItem[]) {
    onChange(next);
  }

  function addPrompt() {
    update([
      ...items,
      { id: crypto.randomUUID(), name: `prompt-${items.length + 1}`, description: '', content: '' }
    ]);
  }

  function removePrompt(index: number) {
    update(items.filter((_, i) => i !== index));
  }

  function patch(index: number, partial: Partial<PromptItem>) {
    update(items.map((p, i) => (i === index ? { ...p, ...partial } : p)));
  }

  function isReserved(name: string): boolean {
    return RESERVED.includes(name.trim().replace(/^\//, '').toLowerCase());
  }

  function hasSpaces(name: string): boolean {
    return /\s/.test(name.trim());
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="lightbulb" size={14} /> Prompts</h3>
    <button class="j-btn" onclick={addPrompt}><Icon name="add" size={13} /> Add prompt</button>
  </div>

  <p class="j-hint">
    Saved prompts, invoked with <code>/name</code> in the chat. Any text after the command is
    appended to the prompt content.
  </p>

  {#if items.length === 0}
    <div class="j-empty">No saved prompt yet.</div>
  {/if}

  {#each items as prompt, index (prompt.id)}
    <div class="j-card">
      <div class="j-row">
        <span class="slash">/</span>
        <input
          class="j-input"
          style="width: 11rem"
          placeholder="name (e.g. review)"
          value={prompt.name}
          oninput={e => patch(index, { name: (e.target as HTMLInputElement).value })}
        />
        <input
          class="j-input j-grow"
          placeholder="Description (optional)"
          value={prompt.description ?? ''}
          oninput={e => patch(index, { description: (e.target as HTMLInputElement).value || undefined })}
        />
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removePrompt(index)}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      {#if isReserved(prompt.name)}
        <div class="warn">“/{prompt.name}” is a reserved command (/tdd, /workflow, /agent) — this prompt will be ignored.</div>
      {:else if hasSpaces(prompt.name)}
        <div class="warn">The name must not contain spaces.</div>
      {/if}
      <label class="j-field">
        <span>Content</span>
        <textarea
          class="j-textarea"
          rows="4"
          placeholder="e.g. Review the following code and list potential bugs:"
          value={prompt.content}
          oninput={e => patch(index, { content: (e.target as HTMLTextAreaElement).value })}
        ></textarea>
      </label>
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

  code {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .slash {
    font-family: var(--vscode-editor-font-family, monospace);
    font-weight: 600;
    color: var(--vscode-descriptionForeground);
  }

  .warn {
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-terminal-ansiYellow);
  }
</style>
