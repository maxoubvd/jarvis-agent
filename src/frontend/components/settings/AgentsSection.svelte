<script lang="ts">
  import type { SpecializedAgent } from '../../shared/types';
  import Icon from '../Icon.svelte';

  interface Props {
    items?: SpecializedAgent[];
    defaults?: SpecializedAgent[];
    onChange?: (next: SpecializedAgent[]) => void;
  }

  let { items = [], defaults = [], onChange = () => {} }: Props = $props();

  function update(next: SpecializedAgent[]) {
    onChange(next);
  }

  /** Cartes dépliées (nouvel agent = ouvert en édition). */
  let expanded = $state<Record<string, boolean>>({});

  function addAgent() {
    const id = crypto.randomUUID();
    expanded[id] = true;
    update([
      ...items,
      {
        id,
        mention: '@My-Agent',
        label: 'My Agent',
        description: '',
        systemPrompt: '',
        keywords: []
      }
    ]);
  }

  function removeAgent(index: number) {
    update(items.filter((_, i) => i !== index));
  }

  function patch(index: number, partial: Partial<SpecializedAgent>) {
    update(items.map((a, i) => (i === index ? { ...a, ...partial } : a)));
  }

  function resetToDefaults() {
    // snapshot d'abord : structuredClone ne sait pas cloner un proxy $state.
    update(structuredClone($state.snapshot(defaults)) as SpecializedAgent[]);
  }

  function keywordsText(agent: SpecializedAgent): string {
    return (agent.keywords ?? []).join(', ');
  }

  function parseKeywords(text: string): string[] {
    return text.split(',').map(k => k.trim()).filter(Boolean);
  }

  function toolsText(agent: SpecializedAgent): string {
    return (agent.allowedToolPrefixes ?? []).join(', ');
  }

  function parseTools(text: string): string[] | undefined {
    const list = text.split(',').map(t => t.trim()).filter(Boolean);
    return list.length > 0 ? list : undefined;
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="tools" size={14} /> Agents</h3>
    <div class="j-row">
      <button class="j-btn" onclick={resetToDefaults}>Reset to defaults</button>
      <button class="j-btn" onclick={addAgent}><Icon name="add" size={13} /> Add agent</button>
    </div>
  </div>

  <p class="j-hint">
    Specialized agents invoked with an @mention in the chat. Leave untouched to follow the
    built-in defaults automatically.
  </p>

  {#if items.length === 0}
    <div class="j-empty">No agents. "Reset to defaults" restores the built-in agents.</div>
  {/if}

  {#each items as agent, index (agent.id)}
    <div class="j-card">
      <div class="j-row">
        <button
          class="j-expand"
          title={expanded[agent.id] ? 'Collapse' : 'Edit agent'}
          onclick={() => (expanded[agent.id] = !expanded[agent.id])}
        >
          <Icon name={expanded[agent.id] ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        <span class="j-title">{agent.mention.trim() || '(unnamed agent)'}</span>
        <span class="j-sub j-grow">{agent.label}</span>
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removeAgent(index)}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      {#if agent.mention && !agent.mention.startsWith('@')}
        <div class="warn">The mention should start with “@”.</div>
      {/if}
      {#if expanded[agent.id]}
        <div class="j-row">
          <input
            class="j-input"
            style="width: 10rem"
            placeholder="@Mention"
            value={agent.mention}
            oninput={e => patch(index, { mention: (e.target as HTMLInputElement).value })}
          />
          <input
            class="j-input j-grow"
            placeholder="Label"
            value={agent.label}
            oninput={e => patch(index, { label: (e.target as HTMLInputElement).value })}
          />
        </div>
        <label class="j-field">
          <span>Description</span>
          <input
            class="j-input"
            value={agent.description}
            oninput={e => patch(index, { description: (e.target as HTMLInputElement).value })}
          />
        </label>
        <label class="j-field">
          <span>System prompt</span>
          <textarea
            class="j-textarea"
            rows="4"
            value={agent.systemPrompt}
            oninput={e => patch(index, { systemPrompt: (e.target as HTMLTextAreaElement).value })}
          ></textarea>
        </label>
        <label class="j-field">
          <span>Keywords (comma-separated, used for auto-suggestion)</span>
          <input
            class="j-input"
            value={keywordsText(agent)}
            oninput={e => patch(index, { keywords: parseKeywords((e.target as HTMLInputElement).value) })}
          />
        </label>
        <label class="j-field">
          <span>Allowed tools (comma-separated tool names, empty = all tools)</span>
          <input
            class="j-input"
            placeholder="e.g. read_file, grep_search, run_terminal_command"
            value={toolsText(agent)}
            oninput={e => patch(index, { allowedToolPrefixes: parseTools((e.target as HTMLInputElement).value) })}
          />
        </label>
        <div class="j-row j-end">
          <button class="j-btn j-btn-primary" onclick={() => (expanded[agent.id] = false)}>
            <Icon name="check" size={13} /> Validate
          </button>
        </div>
      {/if}
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

  .warn {
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-terminal-ansiYellow);
  }

  p {
    margin: 0;
  }
</style>
