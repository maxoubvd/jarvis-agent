<script lang="ts">
  import type {
    JarvisConfig,
    ModelItem,
    OptimizationConfig,
    McpServerConfig,
    McpServerStatus,
    BuiltinMcpOverride,
    PromptItem,
    RuleItem,
    SpecializedAgent,
    ToolPolicy,
    Workflow,
    DocSite,
    DocsSiteStatus,
    WorkspaceProfile,
    SettingsDefaults
  } from '../shared/types';
  import Icon from './Icon.svelte';
  import Toggle from './Toggle.svelte';
  import ModelsSection from './settings/ModelsSection.svelte';
  import McpSection, { type McpEntry } from './settings/McpSection.svelte';
  import PromptsSection from './settings/PromptsSection.svelte';
  import AgentsSection from './settings/AgentsSection.svelte';
  import WorkflowsSection from './settings/WorkflowsSection.svelte';
  import DocsSection from './settings/DocsSection.svelte';
  import WorkspacesSection from './settings/WorkspacesSection.svelte';

  interface Props {
    settings?: JarvisConfig | null;
    defaults?: SettingsDefaults | null;
    saveStatus?: { ok: boolean; error?: string; pending?: boolean } | null;
    mcpServers?: McpServerStatus[];
    docsStatuses?: DocsSiteStatus[];
    currentFolder?: string;
    indexStatus?: { indexing: boolean; fileCount: number } | null;
    onSave?: (config: JarvisConfig) => void;
    onIndexDocs?: (id: string) => void;
    onReindex?: () => void;
    onOpenConfig?: () => void;
    onOpenGuide?: () => void;
  }

  let {
    settings = null,
    defaults = null,
    saveStatus = null,
    mcpServers = [],
    docsStatuses = [],
    currentFolder = '',
    indexStatus = null,
    onSave = () => {},
    onIndexDocs = () => {},
    onReindex = () => {},
    onOpenConfig = () => {},
    onOpenGuide = () => {}
  }: Props = $props();

  let modelItems = $state<ModelItem[]>([]);
  let defaultModel = $state<string>('');
  let optimization = $state<OptimizationConfig>({});
  let mcpEntries = $state<McpEntry[]>([]);
  let rules = $state<RuleItem[]>([]);
  let prompts = $state<PromptItem[]>([]);
  let agents = $state<SpecializedAgent[]>([]);
  let workflows = $state<Workflow[]>([]);
  let builtinToggles = $state<Record<string, boolean>>({});
  /** Politique par tool de chaque serveur MCP intégré (id → tool → policy ; absent = ask). */
  let builtinToolPolicies = $state<Record<string, Record<string, ToolPolicy>>>({});
  let toolPolicies = $state<Record<string, ToolPolicy>>({});
  let docs = $state<DocSite[]>([]);
  let workspaces = $state<WorkspaceProfile[]>([]);
  let dirty = $state(false);

  // Re-synchronise l'état local quand une nouvelle config arrive du backend.
  $effect(() => {
    const incoming = settings;
    if (!incoming) return;
    modelItems = structuredClone($state.snapshot(incoming.models.items ?? [])) as ModelItem[];
    defaultModel = incoming.models.default ?? '';
    optimization = structuredClone($state.snapshot(incoming.optimization ?? {}));
    mcpEntries = Object.entries(incoming.mcpServers ?? {}).map(([key, raw]) => {
      const value = structuredClone($state.snapshot(raw)) as McpServerConfig;
      // Migration legacy : disabledTools → toolPolicies[tool] = excluded.
      const policies = { ...(value.toolPolicies ?? {}) };
      for (const tool of value.disabledTools ?? []) {
        if (!policies[tool]) policies[tool] = 'excluded';
      }
      value.toolPolicies = Object.keys(policies).length > 0 ? policies : undefined;
      value.disabledTools = undefined;
      return {
        key,
        value,
        argsText: (value.args ?? []).join('\n'),
        envText: Object.entries(value.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
      };
    });
    rules = structuredClone($state.snapshot(incoming.rules ?? []));
    prompts = structuredClone($state.snapshot(incoming.prompts ?? [])) as PromptItem[];
    // Pré-remplit avec les défauts codés en dur quand la config est vide
    // (même sémantique que getAgents/getWorkflows : config non vide gagne).
    // $state.snapshot est obligatoire des deux côtés : structuredClone ne sait
    // pas cloner un proxy $state et ferait planter tout le webview.
    agents = structuredClone(
      $state.snapshot(incoming.agents?.length ? incoming.agents : (defaults?.agents ?? []))
    ) as SpecializedAgent[];
    workflows = structuredClone(
      $state.snapshot(incoming.workflows?.length ? incoming.workflows : (defaults?.workflows ?? []))
    ) as Workflow[];
    builtinToggles = Object.fromEntries(
      (defaults?.builtinMcp ?? []).map(b => [
        b.id,
        incoming.builtinMcp?.[b.id]?.enabled ?? b.defaultEnabled
      ])
    );
    builtinToolPolicies = Object.fromEntries(
      (defaults?.builtinMcp ?? []).map(b => {
        const override = incoming.builtinMcp?.[b.id];
        // Migration legacy : disabledTools → excluded.
        const policies: Record<string, ToolPolicy> = { ...(override?.toolPolicies ?? {}) };
        for (const tool of override?.disabledTools ?? []) {
          if (!policies[tool]) policies[tool] = 'excluded';
        }
        return [b.id, policies];
      })
    );
    toolPolicies = structuredClone($state.snapshot(incoming.toolPolicies ?? {})) as Record<string, ToolPolicy>;
    docs = structuredClone($state.snapshot(incoming.docs ?? [])) as DocSite[];
    workspaces = structuredClone($state.snapshot(incoming.workspaces ?? [])) as WorkspaceProfile[];
    dirty = false;
  });

  function markDirty() {
    dirty = true;
  }

  // --- MCP servers ---

  function onBuiltinToolPolicy(id: string, tool: string, policy: ToolPolicy) {
    const current = { ...(builtinToolPolicies[id] ?? {}) };
    // `ask` est le défaut MCP — on n'écrit que les écarts.
    if (policy === 'ask') delete current[tool];
    else current[tool] = policy;
    builtinToolPolicies[id] = current;
    markDirty();
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

  /** Cartes de règles dépliées (nouvelle règle = ouverte en édition). */
  let expandedRules = $state<Record<string, boolean>>({});

  function addRule() {
    const id = crypto.randomUUID();
    expandedRules[id] = true;
    rules = [...rules, { id, name: `Rule ${rules.length + 1}`, enabled: true, content: '' }];
    markDirty();
  }

  function removeRule(index: number) {
    rules = rules.filter((_, i) => i !== index);
    markDirty();
  }

  /**
   * Règle omit-if-unchanged : si la liste éditée est identique aux défauts,
   * on n'écrit rien dans la config — les futurs changements de défauts restent
   * ainsi suivis (sémantique getAgents/getWorkflows : « config non vide gagne »).
   */
  function omitIfDefault<T>(edited: T[], defaultItems: T[] | undefined): T[] | undefined {
    if (edited.length === 0) return undefined;
    if (defaultItems && JSON.stringify(edited) === JSON.stringify(defaultItems)) return undefined;
    return edited;
  }

  /** N'écrit un override que si l'activation diffère du défaut ou des politiques par tool existent. */
  function serializeBuiltinMcp(): Record<string, BuiltinMcpOverride> | undefined {
    const out: Record<string, BuiltinMcpOverride> = {};
    for (const b of defaults?.builtinMcp ?? []) {
      const override: BuiltinMcpOverride = {};
      const enabled = builtinToggles[b.id] ?? b.defaultEnabled;
      if (enabled !== b.defaultEnabled) override.enabled = enabled;
      const policies = builtinToolPolicies[b.id] ?? {};
      // disabledTools (legacy) n'est plus écrit : migré vers toolPolicies.
      if (Object.keys(policies).length > 0) override.toolPolicies = { ...policies };
      if (Object.keys(override).length > 0) out[b.id] = override;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  function serialize(): JarvisConfig {
    const items: ModelItem[] = ($state.snapshot(modelItems) as ModelItem[])
      .filter(m => m.name.trim())
      .map(m => ({ ...m, name: m.name.trim(), model: (m.model || m.name).trim() }));
    const mcpRecord: Record<string, McpServerConfig> = {};
    for (const entry of mcpEntries) {
      if (!entry.key.trim()) continue;
      const args = entry.argsText.split('\n').map(l => l.trim()).filter(Boolean);
      const entryPolicies = entry.value.toolPolicies ?? {};
      mcpRecord[entry.key.trim()] = {
        enabled: entry.value.enabled,
        transport: entry.value.transport,
        command: entry.value.transport === 'stdio' ? entry.value.command : undefined,
        args: entry.value.transport === 'stdio' && args.length > 0 ? args : undefined,
        env: entry.value.transport === 'stdio' ? parseEnv(entry.envText) : undefined,
        url: entry.value.transport === 'sse' ? entry.value.url : undefined,
        toolPolicies: Object.keys(entryPolicies).length > 0 ? { ...entryPolicies } : undefined
      };
    }

    const config: JarvisConfig = {
      version: settings?.version ?? 1,
      models: {
        default: defaultModel || null,
        items
      },
      mcpServers: Object.keys(mcpRecord).length > 0 ? mcpRecord : undefined,
      rules: rules.filter(r => r.content.trim() || r.name.trim()),
      prompts: (() => {
        const kept = ($state.snapshot(prompts) as PromptItem[]).filter(
          p => p.name.trim() || p.content.trim()
        );
        return kept.length > 0 ? kept : undefined;
      })(),
      workflows: omitIfDefault($state.snapshot(workflows) as Workflow[], defaults?.workflows),
      agents: omitIfDefault($state.snapshot(agents) as SpecializedAgent[], defaults?.agents),
      builtinMcp: serializeBuiltinMcp(),
      toolPolicies: Object.keys(toolPolicies).length > 0 ? toolPolicies : undefined,
      docs: docs.length > 0 ? ($state.snapshot(docs) as DocSite[]) : undefined,
      workspaces: workspaces.length > 0 ? ($state.snapshot(workspaces) as WorkspaceProfile[]) : undefined,
      // Non édité ici — préservé pour ne pas réinitialiser le workspace actif.
      activeWorkspaceId: settings?.activeWorkspaceId,
      optimization
    };
    // Dé-proxifie en profondeur (rules, optimization… sont des proxies $state) :
    // postMessage utilise le clonage structuré, qui plante sur un Proxy — la
    // sauvegarde échouerait silencieusement.
    return $state.snapshot(config) as JarvisConfig;
  }

  function save() {
    onSave(serialize());
    dirty = false;
  }
</script>

<section class="settings">
  <header class="settings-header">
    <h2><Icon name="gear" size={15} /> Settings</h2>
    <div class="actions">
      {#if saveStatus}
        <span
          class="save-status"
          class:error={!saveStatus.ok}
          class:pending={saveStatus.pending}
          role="status"
        >
          <Icon name={saveStatus.pending ? 'sync' : saveStatus.ok ? 'check' : 'error'} size={12} />
          {saveStatus.pending
            ? 'Saving…'
            : saveStatus.ok
              ? 'Saved ✓'
              : (saveStatus.error ?? 'Error')}
        </span>
      {/if}
      <button title="Open User Guide" onclick={onOpenGuide}>
        User Guide
      </button>
      <button title="Open ~/.jarvis/config.json in the editor" onclick={onOpenConfig}>
        Edit config file
      </button>
      <button class="primary" onclick={save} disabled={!dirty}>Save</button>
    </div>
  </header>

  <p class="hint">
    Stored in the global config (<code>~/.jarvis/config.json</code>). No model is configured by
    default — add a provider and API key to get started.
  </p>

  <!-- Models -->
  <ModelsSection
    items={modelItems}
    {defaultModel}
    onChange={next => { modelItems = next; markDirty(); }}
    onDefaultChange={name => { defaultModel = name; markDirty(); }}
  />

  <!-- Tools & MCP servers (politiques d'outils incluses) -->
  <McpSection
    builtins={defaults?.builtinMcp ?? []}
    {builtinToggles}
    {builtinToolPolicies}
    entries={mcpEntries}
    statuses={mcpServers}
    agentTools={defaults?.agentTools ?? []}
    customTools={defaults?.customTools ?? []}
    {toolPolicies}
    onToolPoliciesChange={next => { toolPolicies = next; markDirty(); }}
    onBuiltinToggle={(id, on) => { builtinToggles[id] = on; markDirty(); }}
    {onBuiltinToolPolicy}
    onEntriesChange={next => { mcpEntries = next; markDirty(); }}
  />

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
          <button
            class="j-expand"
            title={expandedRules[rule.id] ? 'Collapse' : 'Edit rule'}
            onclick={() => (expandedRules[rule.id] = !expandedRules[rule.id])}
          >
            <Icon name={expandedRules[rule.id] ? 'chevron-up' : 'chevron-down'} size={13} />
          </button>
          <span class="j-title j-grow">{rule.name.trim() || '(unnamed rule)'}</span>
          <Toggle
            checked={rule.enabled}
            label="Enabled"
            onchange={on => { rule.enabled = on; markDirty(); }}
          />
          <button class="danger" onclick={() => removeRule(rIndex)}>Remove</button>
        </div>
        {#if expandedRules[rule.id]}
          <input class="provider-name" placeholder="rule name" bind:value={rule.name} oninput={markDirty} />
          <textarea
            rows="2"
            bind:value={rule.content}
            oninput={markDirty}
            placeholder="e.g. Always write tests for new code. Use French for comments."
          ></textarea>
          <div class="j-row j-end">
            <button class="primary" onclick={() => (expandedRules[rule.id] = false)}>
              <Icon name="check" size={13} /> Validate
            </button>
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Prompts -->
  <PromptsSection
    items={prompts}
    onChange={next => { prompts = next; markDirty(); }}
  />

  <!-- Workspaces -->
  <WorkspacesSection
    items={workspaces}
    {currentFolder}
    {indexStatus}
    onChange={next => { workspaces = next; markDirty(); }}
    {onReindex}
  />

  <!-- Docs -->
  <DocsSection
    sites={docs}
    statuses={docsStatuses}
    {dirty}
    onChange={next => { docs = next; markDirty(); }}
    onIndex={onIndexDocs}
  />

  <!-- Agents -->
  <AgentsSection
    items={agents}
    defaults={defaults?.agents ?? []}
    onChange={next => { agents = next; markDirty(); }}
  />

  <!-- Workflows -->
  <WorkflowsSection
    items={workflows}
    defaults={defaults?.workflows ?? []}
    onChange={next => { workflows = next; markDirty(); }}
  />

  <!-- Optimization -->
  <div class="group">
    <div class="group-head"><h3>Optimization</h3></div>

    <label class="field">
      <span>Chat mode</span>
      <select bind:value={optimization.chatMode} onchange={markDirty}>
        <option value={undefined}>— agent (uses tools) — default</option>
        <option value="agent">agent (uses tools)</option>
        <option value="chat">chat (text only, streaming)</option>
      </select>
    </label>

    <label class="field">
      <span>HITL mode</span>
      <select bind:value={optimization.hitlMode} onchange={markDirty}>
        <option value={undefined}>— default —</option>
        <option value="strict">strict</option>
        <option value="moderate">moderate</option>
        <option value="free">free</option>
      </select>
    </label>

    <Toggle
      checked={optimization.showThinking ?? true}
      label="Show thinking blocks in the chat"
      onchange={on => { optimization.showThinking = on; markDirty(); }}
    />

    <label class="field">
      <span>Response verbosity</span>
      <select bind:value={optimization.verbosity} onchange={markDirty}>
        <option value={undefined}>— normal — default</option>
        <option value="concise">concise — brief and to the point</option>
        <option value="normal">normal</option>
        <option value="detailed">detailed — explanatory</option>
      </select>
    </label>

    <label class="field">
      <span>Agent max iterations</span>
      <input type="number" min="1" bind:value={optimization.agentMaxIterations} oninput={markDirty} placeholder="25" />
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
    font-size: var(--jarvis-text-md);
    font-weight: 600;
    letter-spacing: -0.01em;
    display: flex;
    align-items: center;
    gap: var(--jarvis-space-1);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .save-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: var(--jarvis-radius-pill);
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-terminal-ansiGreen);
    background: rgba(0, 200, 80, 0.12);
  }

  .save-status.pending {
    color: var(--vscode-descriptionForeground);
    background: rgba(128, 128, 128, 0.12);
  }

  .save-status.error {
    color: var(--vscode-terminal-ansiRed);
    background: rgba(220, 50, 50, 0.12);
    /* Le message d'erreur peut être long — autorise le retour à la ligne. */
    white-space: normal;
    max-width: 20rem;
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
    border-radius: var(--jarvis-radius-lg);
    padding: var(--jarvis-space-4);
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
    border-radius: var(--jarvis-radius-md);
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
    outline: 1px solid var(--jarvis-accent);
    outline-offset: -1px;
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
    outline: 1px solid var(--jarvis-accent);
    outline-offset: -1px;
  }

  button {
    padding: 5px 12px;
    background: var(--vscode-button-secondaryBackground, var(--vscode-editorWidget-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-pill);
    cursor: pointer;
    font-size: var(--jarvis-text-sm);
    transition: background var(--jarvis-transition);
  }

  button:hover:not(:disabled) {
    background: var(--vscode-list-hoverBackground);
  }

  button.primary {
    background: var(--jarvis-accent);
    color: var(--jarvis-accent-fg);
    border-color: transparent;
  }

  button.primary:hover:not(:disabled) {
    background: var(--jarvis-accent-hover);
  }

  button.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.danger {
    color: var(--vscode-terminal-ansiRed);
  }
</style>
