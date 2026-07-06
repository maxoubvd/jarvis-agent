<script lang="ts">
  import type { DocSite, DocsSiteStatus } from '../../shared/types';
  import Icon from '../Icon.svelte';
  import Toggle from '../Toggle.svelte';

  interface Props {
    sites?: DocSite[];
    statuses?: DocsSiteStatus[];
    /** true tant que les modifications ne sont pas sauvegardées. */
    dirty?: boolean;
    onChange?: (next: DocSite[]) => void;
    onIndex?: (id: string) => void;
  }

  let { sites = [], statuses = [], dirty = false, onChange = () => {}, onIndex = () => {} }: Props = $props();

  function statusFor(id: string): DocsSiteStatus | undefined {
    return statuses.find(s => s.id === id);
  }

  function addSite() {
    onChange([
      ...sites,
      { id: crypto.randomUUID(), title: '', startUrl: '', enabled: true }
    ]);
  }

  function removeSite(index: number) {
    onChange(sites.filter((_, i) => i !== index));
  }

  function patch(index: number, partial: Partial<DocSite>) {
    onChange(sites.map((s, i) => (i === index ? { ...s, ...partial } : s)));
  }

  function formatDate(iso?: string): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="book" size={14} /> Docs</h3>
    <button class="j-btn" onclick={addSite}><Icon name="add" size={13} /> Add site</button>
  </div>

  <p class="j-hint">
    Documentation sites are crawled (same domain, ~50 pages max), cached locally and indexed —
    query them in the chat with <code>@docs:&lt;topic&gt;</code>.
  </p>

  {#if sites.length === 0}
    <div class="j-empty">No documentation site yet.</div>
  {/if}

  {#each sites as site, index (site.id)}
    {@const status = statusFor(site.id)}
    <div class="j-card" class:disabled={!site.enabled}>
      <div class="j-row">
        <input
          class="j-input"
          style="width: 10rem"
          placeholder="Title (e.g. Svelte 5)"
          value={site.title}
          oninput={e => patch(index, { title: (e.target as HTMLInputElement).value })}
        />
        <input
          class="j-input j-grow"
          placeholder="https://svelte.dev/docs"
          value={site.startUrl}
          oninput={e => patch(index, { startUrl: (e.target as HTMLInputElement).value })}
        />
        <Toggle
          checked={site.enabled}
          label="Enabled"
          onchange={on => patch(index, { enabled: on })}
        />
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removeSite(index)}>
          <Icon name="trash" size={13} />
        </button>
      </div>

      <div class="status-row">
        {#if status?.state === 'indexing'}
          <span class="status indexing">
            <Icon name="sync" size={12} /> Indexing… {status.pages} page{status.pages === 1 ? '' : 's'}
          </span>
        {:else if status?.state === 'error'}
          <span class="status error"><Icon name="error" size={12} /> {status.error}</span>
        {:else if status && status.pages > 0}
          <span class="status ok">
            <Icon name="check" size={12} />
            {status.pages} page{status.pages === 1 ? '' : 's'}
            {#if status.indexedAt}· indexed {formatDate(status.indexedAt)}{/if}
          </span>
        {:else}
          <span class="status">Not indexed yet</span>
        {/if}

        <button
          class="j-btn"
          disabled={dirty || !site.startUrl.trim() || status?.state === 'indexing'}
          title={dirty ? 'Save settings before indexing' : ''}
          onclick={() => onIndex(site.id)}
        >
          <Icon name="globe" size={13} />
          {status && status.pages > 0 ? 'Re-index' : 'Index'}
        </button>
        {#if dirty}
          <span class="j-hint">Save before indexing</span>
        {/if}
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

  code {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-2);
    flex-wrap: wrap;
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

  .status.error {
    color: var(--vscode-terminal-ansiRed);
  }

  .status.indexing {
    color: var(--jarvis-gold);
  }
</style>
