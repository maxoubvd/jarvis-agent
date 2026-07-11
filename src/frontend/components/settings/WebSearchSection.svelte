<script lang="ts">
  import type { WebSearchConfig } from '../../shared/types';
  import Icon from '../Icon.svelte';
  import Toggle from '../Toggle.svelte';

  interface Props {
    config?: WebSearchConfig;
    onChange?: (next: WebSearchConfig) => void;
  }

  let { config = { provider: 'brave' }, onChange = () => {} }: Props = $props();

  /** Sources courantes proposées par défaut — l'utilisateur peut aussi taper des domaines libres. */
  const PRESET_SITES = ['stackoverflow.com', 'developer.mozilla.org', 'github.com', 'devdocs.io'];

  function extraSitesText(cfg: WebSearchConfig): string {
    return (cfg.defaultSites ?? []).filter(s => !PRESET_SITES.includes(s)).join(', ');
  }

  function patch(partial: Partial<WebSearchConfig>) {
    onChange({ provider: 'brave', ...config, ...partial });
  }

  function toggleSite(site: string, on: boolean) {
    const current = config.defaultSites ?? [];
    patch({ defaultSites: on ? [...current, site] : current.filter(s => s !== site) });
  }

  function updateExtraSites(text: string) {
    const extra = text.split(',').map(s => s.trim()).filter(Boolean);
    const presetsOn = (config.defaultSites ?? []).filter(s => PRESET_SITES.includes(s));
    patch({ defaultSites: [...presetsOn, ...extra] });
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="globe" size={14} /> Web Search</h3>
  </div>

  <p class="j-hint">
    Backs the agent's <code>search_web</code> tool with the Brave Search API. Without an API key,
    the tool reports itself as unconfigured instead of failing silently.
  </p>

  <a class="key-link" href="https://api-dashboard.search.brave.com/" title="https://api-dashboard.search.brave.com/">
    <Icon name="globe" size={12} /> Get a Brave Search API key
  </a>

  <label class="j-field">
    <span>API key</span>
    <input
      class="j-input"
      type="password"
      autocomplete="off"
      placeholder="BSA…"
      value={config.apiKey ?? ''}
      oninput={e => patch({ apiKey: (e.target as HTMLInputElement).value || undefined })}
    />
  </label>

  <div class="j-field">
    <span>Default sources (applied when the model doesn't specify any)</span>
    <div class="j-row">
      {#each PRESET_SITES as site (site)}
        <Toggle
          checked={(config.defaultSites ?? []).includes(site)}
          label={site}
          onchange={on => toggleSite(site, on)}
        />
      {/each}
    </div>
  </div>

  <label class="j-field">
    <span>Other domains (comma-separated, optional)</span>
    <input
      class="j-input"
      placeholder="e.g. reactjs.org, nodejs.org"
      value={extraSitesText(config)}
      oninput={e => updateExtraSites((e.target as HTMLInputElement).value)}
    />
  </label>
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

  .key-link {
    display: inline-flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    align-self: flex-start;
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-textLink-foreground, var(--jarvis-accent));
    text-decoration: none;
  }

  .key-link:hover {
    text-decoration: underline;
  }
</style>
