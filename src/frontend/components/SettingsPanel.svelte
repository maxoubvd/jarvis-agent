<script lang="ts">
  import type {
    JarvisConfig,
    ProviderConfigItem,
    ProviderType,
    OptimizationConfig,
    McpServerConfig,
    RuleItem
  } from '../shared/types';

  interface McpServerStatus {
    name: string;
    enabled: boolean;
    connected: boolean;
    tools: string[];
    error?: string;
  }

  interface Props {
    settings?: JarvisConfig | null;
    saveStatus?: { ok: boolean; error?: string } | null;
    mcpServers?: McpServerStatus[];
    onSave?: (config: JarvisConfig) => void;
  }

  let { settings = null, saveStatus = null, mcpServers = [], onSave = () => {} }: Props = $props();

  interface ProviderEntry {
    key: string;
    value: ProviderConfigItem;
  }

  const PROVIDER_TYPES: ProviderType[] = [
    'openai-compatible',
    'ollama',
    'openrouter',
    'lmstudio',
    'mistral'
  ];

  const DEFAULT_BASE_URL: Record<ProviderType, string> = {
    ollama: 'http://localhost:11434',
    openrouter: 'https://openrouter.ai/api/v1',
    lmstudio: 'http://localhost:1234/v1',
    mistral: 'https://api.mistral.ai/v1',
    'openai-compatible': 'https://api.openai.com/v1'
  };

  interface McpEntry {
    key: string;
    value: McpServerConfig;
    /** Représentation éditable de args (une par ligne). */
    argsText: string;
    /** Représentation éditable de env (KEY=value, une par ligne). */
    envText: string;
  }

  let providers = $state<ProviderEntry[]>([]);
  let defaultModel = $state<string>('');
  let optimization = $state<OptimizationConfig>({});
  let mcpEntries = $state<McpEntry[]>([]);
  let rules = $state<RuleItem[]>([]);
  let dirty = $state(false);

  // Re-synchronise l'état local quand une nouvelle config arrive du backend.
  $effect(() => {
    const incoming = settings;
    if (!incoming) return;
    providers = Object.entries(incoming.models.providers ?? {}).map(([key, value]) => ({
      key,
      value: structuredClone($state.snapshot(value))
    }));
    defaultModel = incoming.models.default ?? '';
    optimization = structuredClone($state.snapshot(incoming.optimization ?? {}));
    mcpEntries = Object.entries(incoming.mcpServers ?? {}).map(([key, value]) => ({
      key,
      value: structuredClone($state.snapshot(value)),
      argsText: (value.args ?? []).join('\n'),
      envText: Object.entries(value.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
    }));
    rules = structuredClone($state.snapshot(incoming.rules ?? []));
    dirty = false;
  });

  function markDirty() {
    dirty = true;
  }

  function allModelNames(): string[] {
    return providers
      .filter(p => p.value.enabled)
      .flatMap(p => p.value.models.map(m => m.name))
      .filter(Boolean);
  }

  function addProvider() {
    let base = 'provider';
    let key = base;
    let i = 1;
    const used = new Set(providers.map(p => p.key));
    while (used.has(key)) key = `${base}-${++i}`;
    providers = [
      ...providers,
      {
        key,
        value: {
          enabled: true,
          type: 'openai-compatible',
          baseUrl: DEFAULT_BASE_URL['openai-compatible'],
          apiKey: '',
          models: []
        }
      }
    ];
    markDirty();
  }

  function removeProvider(index: number) {
    providers = providers.filter((_, i) => i !== index);
    markDirty();
  }

  function onTypeChange(entry: ProviderEntry, type: ProviderType) {
    entry.value.type = type;
    if (!entry.value.baseUrl || Object.values(DEFAULT_BASE_URL).includes(entry.value.baseUrl)) {
      entry.value.baseUrl = DEFAULT_BASE_URL[type];
    }
    providers = [...providers];
    markDirty();
  }

  function addModel(entry: ProviderEntry) {
    entry.value.models = [...entry.value.models, { name: '', contextLength: 32768 }];
    providers = [...providers];
    markDirty();
  }

  function removeModel(entry: ProviderEntry, index: number) {
    entry.value.models = entry.value.models.filter((_, i) => i !== index);
    providers = [...providers];
    markDirty();
  }

  function needsApiKey(type: ProviderType | undefined): boolean {
    return type === 'openrouter' || type === 'mistral' || type === 'openai-compatible';
  }

  // --- MCP servers ---

  function addMcpServer() {
    let key = 'server';
    let i = 1;
    const used = new Set(mcpEntries.map(e => e.key));
    while (used.has(key)) key = `server-${++i}`;
    mcpEntries = [
      ...mcpEntries,
      { key, value: { enabled: true, transport: 'stdio', command: '' }, argsText: '', envText: '' }
    ];
    markDirty();
  }

  function removeMcpServer(index: number) {
    mcpEntries = mcpEntries.filter((_, i) => i !== index);
    markDirty();
  }

  function statusFor(key: string): McpServerStatus | undefined {
    return mcpServers.find(s => s.name === key);
  }

  function parseEnv(text: string): Record<string, string> | undefined {
    const entries = text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => {
        const eq = l.indexOf('=');
        return eq === -1 ? [l, ''] : [l.slice(0, eq).trim(), l.slice(eq + 1).trim()];
      });
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  // --- Rules ---

  function addRule() {
    rules = [
      ...rules,
      { id: crypto.randomUUID(), name: `Rule ${rules.length + 1}`, enabled: true, content: '' }
    ];
    markDirty();
  }

  function removeRule(index: number) {
    rules = rules.filter((_, i) => i !== index);
    markDirty();
  }

  function serialize(): JarvisConfig {
    const providerRecord: Record<string, ProviderConfigItem> = {};
    for (const { key, value } of providers) {
      if (!key.trim()) continue;
      providerRecord[key.trim()] = {
        enabled: value.enabled,
        type: value.type,
        baseUrl: value.baseUrl,
        apiKey: value.apiKey,
        models: value.models
          .filter(m => m.name.trim())
          .map(m => ({ name: m.name.trim(), contextLength: Number(m.contextLength) || 32768 }))
      };
    }
    const mcpRecord: Record<string, McpServerConfig> = {};
    for (const entry of mcpEntries) {
      if (!entry.key.trim()) continue;
      const args = entry.argsText.split('\n').map(l => l.trim()).filter(Boolean);
      mcpRecord[entry.key.trim()] = {
        enabled: entry.value.enabled,
        transport: entry.value.transport,
        command: entry.value.transport === 'stdio' ? entry.value.command : undefined,
        args: entry.value.transport === 'stdio' && args.length > 0 ? args : undefined,
        env: entry.value.transport === 'stdio' ? parseEnv(entry.envText) : undefined,
        url: entry.value.transport === 'sse' ? entry.value.url : undefined
      };
    }

    return {
      version: settings?.version ?? 1,
      models: {
        default: defaultModel || null,
        providers: providerRecord
      },
      mcpServers: Object.keys(mcpRecord).length > 0 ? mcpRecord : undefined,
      rules: rules.filter(r => r.content.trim() || r.name.trim()),
      // Non édités ici — préservés pour ne pas les perdre à la sauvegarde.
      workflows: settings?.workflows,
      agents: settings?.agents,
      optimization
    };
  }

  function save() {
    onSave(serialize());
    dirty = false;
  }
</script>

<section class="settings">
  <header class="settings-header">
    <h2>⚙️ Settings</h2>
    <div class="actions">
      {#if saveStatus}
        <span class="save-status" class:error={!saveStatus.ok}>
          {saveStatus.ok ? '✅ Saved' : `❌ ${saveStatus.error ?? 'Error'}`}
        </span>
      {/if}
      <button class="primary" onclick={save} disabled={!dirty}>Save</button>
    </div>
  </header>

  <p class="hint">
    Stored in the global config (<code>~/.jarvis/config.json</code>). No model is configured by
    default — add a provider and API key to get started.
  </p>

  <!-- Providers & Models -->
  <div class="group">
    <div class="group-head">
      <h3>Models & Providers</h3>
      <button onclick={addProvider}>+ Add provider</button>
    </div>

    {#if providers.length === 0}
      <div class="empty">No provider yet. Add one to configure a model.</div>
    {/if}

    {#each providers as entry, pIndex (pIndex)}
      <div class="provider" class:disabled={!entry.value.enabled}>
        <div class="provider-row">
          <input
            class="provider-name"
            placeholder="provider id (e.g. openai)"
            bind:value={entry.key}
            oninput={markDirty}
          />
          <select
            value={entry.value.type ?? 'openai-compatible'}
            onchange={e => onTypeChange(entry, (e.target as HTMLSelectElement).value as ProviderType)}
          >
            {#each PROVIDER_TYPES as t}
              <option value={t}>{t}</option>
            {/each}
          </select>
          <label class="enable">
            <input type="checkbox" bind:checked={entry.value.enabled} onchange={markDirty} />
            Enabled
          </label>
          <button class="danger" onclick={() => removeProvider(pIndex)}>Remove</button>
        </div>

        <label class="field">
          <span>Base URL</span>
          <input bind:value={entry.value.baseUrl} oninput={markDirty} placeholder="https://…" />
        </label>

        {#if needsApiKey(entry.value.type)}
          <label class="field">
            <span>API Key</span>
            <input
              type="password"
              bind:value={entry.value.apiKey}
              oninput={markDirty}
              placeholder="sk-…"
              autocomplete="off"
            />
          </label>
        {/if}

        <div class="models">
          <div class="models-head">
            <span>Models</span>
            <button onclick={() => addModel(entry)}>+ Add model</button>
          </div>
          {#each entry.value.models as model, mIndex (mIndex)}
            <div class="model-row">
              <input
                class="grow"
                placeholder="model name"
                bind:value={model.name}
                oninput={markDirty}
              />
              <input
                class="ctx"
                type="number"
                min="1"
                title="Context length"
                bind:value={model.contextLength}
                oninput={markDirty}
              />
              <label class="default-radio" title="Set as default model">
                <input
                  type="radio"
                  name="default-model"
                  checked={defaultModel === model.name && !!model.name}
                  disabled={!model.name}
                  onchange={() => { defaultModel = model.name; markDirty(); }}
                />
                default
              </label>
              <button class="danger" onclick={() => removeModel(entry, mIndex)}>✕</button>
            </div>
          {/each}
        </div>
      </div>
    {/each}

    {#if allModelNames().length > 0}
      <label class="field default-select">
        <span>Default model</span>
        <select bind:value={defaultModel} onchange={markDirty}>
          <option value="">— none —</option>
          {#each allModelNames() as name}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>

  <!-- MCP servers -->
  <div class="group">
    <div class="group-head">
      <h3>MCP Servers</h3>
      <button onclick={addMcpServer}>+ Add server</button>
    </div>

    {#if mcpEntries.length === 0}
      <div class="empty">No MCP server configured. Add one to expose its tools to the agent.</div>
    {/if}

    {#each mcpEntries as entry, sIndex (sIndex)}
      {@const status = statusFor(entry.key)}
      <div class="provider" class:disabled={!entry.value.enabled}>
        <div class="provider-row">
          <input
            class="provider-name"
            placeholder="server id (e.g. filesystem)"
            bind:value={entry.key}
            oninput={markDirty}
          />
          <select bind:value={entry.value.transport} onchange={markDirty}>
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
          </select>
          <label class="enable">
            <input type="checkbox" bind:checked={entry.value.enabled} onchange={markDirty} />
            Enabled
          </label>
          {#if status}
            <span class="mcp-status" class:ok={status.connected} class:ko={!status.connected && !!status.error}>
              {status.connected ? `● connected (${status.tools.length} tools)` : status.error ? `● ${status.error}` : '○ not connected'}
            </span>
          {/if}
          <button class="danger" onclick={() => removeMcpServer(sIndex)}>Remove</button>
        </div>

        {#if entry.value.transport === 'stdio'}
          <label class="field">
            <span>Command</span>
            <input bind:value={entry.value.command} oninput={markDirty} placeholder="npx" />
          </label>
          <label class="field">
            <span>Arguments (one per line)</span>
            <textarea rows="2" bind:value={entry.argsText} oninput={markDirty} placeholder="-y&#10;@modelcontextprotocol/server-filesystem"></textarea>
          </label>
          <label class="field">
            <span>Environment (KEY=value, one per line)</span>
            <textarea rows="2" bind:value={entry.envText} oninput={markDirty} placeholder="API_TOKEN=…"></textarea>
          </label>
        {:else}
          <label class="field">
            <span>URL</span>
            <input bind:value={entry.value.url} oninput={markDirty} placeholder="https://host/sse" />
          </label>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Rules -->
  <div class="group">
    <div class="group-head">
      <h3>Rules</h3>
      <button onclick={addRule}>+ Add rule</button>
    </div>

    {#if rules.length === 0}
      <div class="empty">No rules yet. Rules are instructions always injected into the system prompt.</div>
    {/if}

    {#each rules as rule, rIndex (rule.id)}
      <div class="provider" class:disabled={!rule.enabled}>
        <div class="provider-row">
          <input class="provider-name" placeholder="rule name" bind:value={rule.name} oninput={markDirty} />
          <label class="enable">
            <input type="checkbox" bind:checked={rule.enabled} onchange={markDirty} />
            Enabled
          </label>
          <button class="danger" onclick={() => removeRule(rIndex)}>Remove</button>
        </div>
        <textarea
          rows="2"
          bind:value={rule.content}
          oninput={markDirty}
          placeholder="e.g. Always write tests for new code. Use French for comments."
        ></textarea>
      </div>
    {/each}
  </div>

  <!-- Optimization -->
  <div class="group">
    <div class="group-head"><h3>Optimization</h3></div>

    <label class="field">
      <span>HITL mode</span>
      <select bind:value={optimization.hitlMode} onchange={markDirty}>
        <option value={undefined}>— default —</option>
        <option value="strict">strict</option>
        <option value="moderate">moderate</option>
        <option value="free">free</option>
      </select>
    </label>

    <label class="field">
      <span>Agent max iterations</span>
      <input type="number" min="1" bind:value={optimization.agentMaxIterations} oninput={markDirty} placeholder="10" />
    </label>

    <label class="field">
      <span>TDD max attempts</span>
      <input type="number" min="1" bind:value={optimization.tddMaxAttempts} oninput={markDirty} placeholder="5" />
    </label>

    <label class="field">
      <span>TDD test command</span>
      <input bind:value={optimization.tddTestCommand} oninput={markDirty} placeholder="npm test" />
    </label>

    <label class="field">
      <span>Terminal timeout (ms)</span>
      <input type="number" min="1000" step="1000" bind:value={optimization.terminalTimeout} oninput={markDirty} placeholder="30000" />
    </label>
  </div>
</section>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    font-size: 0.85rem;
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    background: var(--vscode-editor-background);
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--vscode-panel-border);
    z-index: 1;
  }

  .settings-header h2 {
    margin: 0;
    font-size: 1rem;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .save-status {
    font-size: 0.78rem;
    color: var(--vscode-terminal-ansiGreen);
  }

  .save-status.error {
    color: var(--vscode-terminal-ansiRed);
  }

  .hint {
    margin: 0;
    color: var(--vscode-descriptionForeground);
    font-size: 0.8rem;
  }

  .hint code {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.5rem;
    padding: 0.75rem;
    background: var(--vscode-editorWidget-background);
  }

  .group-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .group-head h3 {
    margin: 0;
    font-size: 0.9rem;
  }

  .empty {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
    font-size: 0.8rem;
  }

  .provider {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 0.4rem;
    padding: 0.6rem;
    background: var(--vscode-editor-background);
  }

  .provider.disabled {
    opacity: 0.6;
  }

  .provider-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .provider-name {
    flex: 1;
    min-width: 8rem;
  }

  .enable {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .field > span {
    font-size: 0.72rem;
    color: var(--vscode-descriptionForeground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .models {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    border-top: 1px dashed var(--vscode-editorWidget-border);
    padding-top: 0.5rem;
  }

  .models-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.72rem;
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
  }

  .model-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .grow {
    flex: 1;
    min-width: 6rem;
  }

  .ctx {
    width: 6rem;
  }

  .default-radio {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .default-select {
    margin-top: 0.25rem;
  }

  .mcp-status {
    font-size: 0.72rem;
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 14rem;
  }

  .mcp-status.ok {
    color: var(--vscode-terminal-ansiGreen);
  }

  .mcp-status.ko {
    color: var(--vscode-terminal-ansiRed);
  }

  textarea {
    padding: 0.35rem 0.45rem;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
    border-radius: 4px;
    font-size: 0.82rem;
    font-family: var(--vscode-editor-font-family, monospace);
    resize: vertical;
  }

  textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
  }

  input,
  select {
    padding: 0.35rem 0.45rem;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
    border-radius: 4px;
    font-size: 0.82rem;
    font-family: inherit;
  }

  input:focus,
  select:focus {
    outline: 1px solid var(--vscode-focusBorder);
  }

  button {
    padding: 0.35rem 0.6rem;
    background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8rem;
  }

  button:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  button.primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: transparent;
  }

  button.primary:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }

  button.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.danger {
    color: var(--vscode-terminal-ansiRed);
  }
</style>
