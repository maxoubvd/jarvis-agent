<script lang="ts" module>
  import type { McpServerConfig } from '../../shared/types';

  /** Entrée éditable d'un serveur MCP utilisateur (args/env en texte brut). */
  export interface McpEntry {
    key: string;
    value: McpServerConfig;
    /** Représentation éditable de args (une par ligne). */
    argsText: string;
    /** Représentation éditable de env (KEY=value, une par ligne). */
    envText: string;
  }
</script>

<script lang="ts">
  import type { McpServerStatus, SettingsDefaults, ToolPolicy } from '../../shared/types';
  import Icon from '../Icon.svelte';
  import Toggle from '../Toggle.svelte';
  import ToolsSection from './ToolsSection.svelte';

  interface Props {
    builtins?: NonNullable<SettingsDefaults['builtinMcp']>;
    builtinToggles?: Record<string, boolean>;
    /** Politique par tool des serveurs intégrés (id → tool → policy ; absent = ask). */
    builtinToolPolicies?: Record<string, Record<string, ToolPolicy>>;
    entries?: McpEntry[];
    statuses?: McpServerStatus[];
    /** Outils intégrés de l'agent — politiques auto/ask/excluded. */
    agentTools?: Array<{ name: string; description: string }>;
    customTools?: Array<{ name: string; description: string }>;
    toolPolicies?: Record<string, ToolPolicy>;
    onToolPoliciesChange?: (next: Record<string, ToolPolicy>) => void;
    onBuiltinToggle?: (id: string, enabled: boolean) => void;
    onBuiltinToolPolicy?: (id: string, tool: string, policy: ToolPolicy) => void;
    onEntriesChange?: (next: McpEntry[]) => void;
    /** Demande au backend le flow "confirmer + git init" (serveur `requiresGitInit`). */
    onRequestGitInit?: (id: string) => void;
  }

  let {
    builtins = [],
    builtinToggles = {},
    builtinToolPolicies = {},
    entries = [],
    statuses = [],
    agentTools = [],
    customTools = [],
    toolPolicies = {},
    onToolPoliciesChange = () => {},
    onBuiltinToggle = () => {},
    onBuiltinToolPolicy = () => {},
    onEntriesChange = () => {},
    onRequestGitInit = () => {}
  }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});

  function toggleExpanded(key: string) {
    expanded[key] = !expanded[key];
  }

  function statusFor(key: string): McpServerStatus | undefined {
    return statuses.find(s => s.name === key);
  }

  function addServer() {
    let key = 'server';
    let i = 1;
    const used = new Set(entries.map(e => e.key));
    while (used.has(key)) key = `server-${++i}`;
    // Nouveau serveur : carte ouverte en mode édition.
    expanded[`custom:${entries.length}`] = true;
    onEntriesChange([
      ...entries,
      { key, value: { enabled: true, transport: 'stdio', command: '' }, argsText: '', envText: '' }
    ]);
  }

  function removeServer(index: number) {
    // Les clés custom:<index> se décalent après suppression — on les replie toutes.
    expanded = Object.fromEntries(
      Object.entries(expanded).filter(([key]) => !key.startsWith('custom:'))
    );
    onEntriesChange(entries.filter((_, i) => i !== index));
  }

  function patchEntry(index: number, partial: Partial<McpEntry>) {
    onEntriesChange(entries.map((e, i) => (i === index ? { ...e, ...partial } : e)));
  }

  function patchEntryValue(index: number, partial: Partial<McpServerConfig>) {
    patchEntry(index, { value: { ...entries[index].value, ...partial } });
  }

  function builtinToolPolicy(id: string, tool: string): ToolPolicy {
    return builtinToolPolicies[id]?.[tool] ?? 'ask';
  }

  function entryToolPolicy(entry: McpEntry, tool: string): ToolPolicy {
    return entry.value.toolPolicies?.[tool] ?? 'ask';
  }

  function setEntryToolPolicy(index: number, tool: string, policy: ToolPolicy) {
    const current = { ...(entries[index].value.toolPolicies ?? {}) };
    // `ask` est le défaut MCP — on n'écrit que les écarts.
    if (policy === 'ask') delete current[tool];
    else current[tool] = policy;
    patchEntryValue(index, { toolPolicies: Object.keys(current).length > 0 ? current : undefined });
  }
</script>

{#snippet toolList(
  status: McpServerStatus | undefined,
  serverEnabled: boolean,
  policyFor: (tool: string) => ToolPolicy,
  onPolicy: (tool: string, policy: ToolPolicy) => void
)}
  {#if status?.connected && status.tools.length > 0}
    <div class="tools">
      {#each status.tools as tool (tool.name)}
        <div class="tool-row" class:off={policyFor(tool.name) === 'excluded'}>
          <div class="tool-info">
            <span class="tool-name">{tool.name}</span>
            {#if tool.description}
              <span class="tool-desc">{tool.description}</span>
            {/if}
          </div>
          <select
            class="j-select tool-policy"
            title={`Execution policy for ${tool.name}`}
            value={policyFor(tool.name)}
            onchange={e => onPolicy(tool.name, (e.target as HTMLSelectElement).value as ToolPolicy)}
          >
            <option value="ask">ask first</option>
            <option value="auto">auto</option>
            <option value="excluded">excluded</option>
          </select>
        </div>
      {/each}
    </div>
  {:else if !serverEnabled}
    <div class="j-empty">Enable the server to list its tools.</div>
  {:else if status?.error}
    <div class="j-empty">Connection failed — no tools to list.</div>
  {:else}
    <div class="j-empty">Connect the server to list its tools (save then reopen Settings).</div>
  {/if}
{/snippet}

{#snippet statusBadge(status: McpServerStatus | undefined)}
  {#if status}
    <span class="mcp-status" class:ok={status.connected} class:ko={!status.connected && !!status.error}>
      {status.connected
        ? `● connected (${status.tools.length} tools)`
        : status.error
          ? `● ${status.error}`
          : '○ not connected'}
    </span>
  {/if}
{/snippet}

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="server" size={14} /> Tools & MCP Servers</h3>
    <button class="j-btn" onclick={addServer}><Icon name="add" size={13} /> Add server</button>
  </div>

  <div class="subhead">Agent tools</div>
  <p class="j-hint">
    Built-in tools with an equivalent on a connected MCP server are hidden — the MCP tool is used
    instead.
  </p>
  <ToolsSection
    builtinTools={agentTools}
    {customTools}
    policies={toolPolicies}
    onChange={onToolPoliciesChange}
  />

  <div class="subhead">MCP servers</div>
  <p class="j-hint">
    Servers expose tools to the agent. Click a server to list its tools and enable/disable them
    individually.
  </p>

  {#if builtins.length > 0}
    <div class="subhead">Built-in servers</div>
    {#each builtins as builtin (builtin.id)}
      {@const status = statusFor(builtin.id)}
      {@const enabled = builtinToggles[builtin.id] ?? builtin.defaultEnabled}
      <div class="j-card" class:disabled={!enabled}>
        <div class="j-row">
          <button
            class="j-expand"
            title={expanded[builtin.id] ? 'Collapse' : 'Show details & tools'}
            onclick={() => toggleExpanded(builtin.id)}
          >
            <Icon name={expanded[builtin.id] ? 'chevron-up' : 'chevron-down'} size={13} />
          </button>
          <span class="server-label">{builtin.label}</span>
          <Toggle
            checked={enabled}
            label="Enabled"
            title={builtin.requiresGitInit ? 'This folder isn\'t a git repository — enabling will offer to run git init' : undefined}
            onchange={on => {
              if (on && builtin.requiresGitInit) {
                // Ne pas activer localement : le backend affiche une
                // confirmation modale puis lance `git init` avant d'activer
                // réellement le serveur (settings/mcpStatus rafraîchis après).
                // On force explicitement `false` (au lieu de ne rien faire)
                // pour que le switch — déjà basculé visuellement par le clic
                // natif du checkbox — revienne bien à l'état éteint tant que
                // le backend n'a pas confirmé.
                onBuiltinToggle(builtin.id, false);
                onRequestGitInit(builtin.id);
                return;
              }
              onBuiltinToggle(builtin.id, on);
            }}
          />
          {@render statusBadge(status)}
        </div>
        {#if expanded[builtin.id]}
          <div class="server-desc">{builtin.description}</div>
          <code class="server-cmd">{builtin.command}</code>
          {@render toolList(
            status,
            enabled,
            tool => builtinToolPolicy(builtin.id, tool),
            (tool, policy) => onBuiltinToolPolicy(builtin.id, tool, policy)
          )}
        {/if}
      </div>
    {/each}
    <div class="subhead">Custom servers</div>
  {/if}

  {#if entries.length === 0}
    <div class="j-empty">No custom MCP server. Add one to expose its tools to the agent.</div>
  {/if}

  {#each entries as entry, sIndex (sIndex)}
    {@const status = statusFor(entry.key)}
    <div class="j-card" class:disabled={!entry.value.enabled}>
      <div class="j-row">
        <button
          class="j-expand"
          title={expanded[`custom:${sIndex}`] ? 'Collapse' : 'Edit server & tools'}
          onclick={() => toggleExpanded(`custom:${sIndex}`)}
        >
          <Icon name={expanded[`custom:${sIndex}`] ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        <span class="j-title">{entry.key.trim() || '(unnamed server)'}</span>
        <span class="j-sub">{entry.value.transport}</span>
        {#if builtins.some(b => b.id === entry.key.trim())}
          <span class="mcp-status ko">shadows the “{entry.key.trim()}” built-in server</span>
        {/if}
        <span class="j-grow"></span>
        <Toggle
          checked={entry.value.enabled}
          label="Enabled"
          onchange={on => patchEntryValue(sIndex, { enabled: on })}
        />
        {@render statusBadge(status)}
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removeServer(sIndex)}>
          <Icon name="trash" size={13} />
        </button>
      </div>

      {#if expanded[`custom:${sIndex}`]}
        <div class="j-row">
          <label class="j-field j-grow">
            <span>Server id</span>
            <input
              class="j-input"
              placeholder="server id"
              value={entry.key}
              oninput={e => patchEntry(sIndex, { key: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="j-field">
            <span>Transport</span>
            <select
              class="j-select"
              value={entry.value.transport}
              onchange={e =>
                patchEntryValue(sIndex, { transport: (e.target as HTMLSelectElement).value as 'stdio' | 'sse' })}
            >
              <option value="stdio">stdio</option>
              <option value="sse">sse</option>
            </select>
          </label>
        </div>

        {#if entry.value.transport === 'stdio'}
          <label class="j-field">
            <span>Command</span>
            <input
              class="j-input"
              placeholder="npx"
              value={entry.value.command ?? ''}
              oninput={e => patchEntryValue(sIndex, { command: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="j-field">
            <span>Arguments (one per line)</span>
            <textarea
              class="j-textarea"
              rows="2"
              placeholder="-y&#10;@modelcontextprotocol/server-filesystem"
              value={entry.argsText}
              oninput={e => patchEntry(sIndex, { argsText: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
          <label class="j-field">
            <span>Environment (KEY=value, one per line)</span>
            <textarea
              class="j-textarea"
              rows="2"
              placeholder="API_TOKEN=…"
              value={entry.envText}
              oninput={e => patchEntry(sIndex, { envText: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
        {:else}
          <label class="j-field">
            <span>URL</span>
            <input
              class="j-input"
              placeholder="https://host/sse"
              value={entry.value.url ?? ''}
              oninput={e => patchEntryValue(sIndex, { url: (e.target as HTMLInputElement).value })}
            />
          </label>
        {/if}

        {@render toolList(
          status,
          entry.value.enabled,
          tool => entryToolPolicy(entry, tool),
          (tool, policy) => setEntryToolPolicy(sIndex, tool, policy)
        )}

        <div class="j-row j-end">
          <button class="j-btn j-btn-primary" onclick={() => (expanded[`custom:${sIndex}`] = false)}>
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

  p {
    margin: 0;
  }

  .subhead {
    font-size: var(--jarvis-text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--vscode-descriptionForeground);
    margin-top: var(--jarvis-space-1);
  }

  .server-label {
    font-weight: 600;
    flex: 1;
    min-width: 8rem;
  }

  .server-desc {
    font-size: var(--jarvis-text-sm);
    color: var(--vscode-descriptionForeground);
  }

  .server-cmd {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12));
    padding: 2px 6px;
    border-radius: var(--jarvis-radius-sm);
    overflow-x: auto;
    white-space: nowrap;
  }

  .mcp-status {
    font-size: var(--jarvis-text-xs);
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

  .tools {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-1);
    border-top: 1px dashed var(--vscode-editorWidget-border);
    padding-top: var(--jarvis-space-2);
  }

  .tool-row {
    display: flex;
    align-items: flex-start;
    gap: var(--jarvis-space-2);
    padding: 2px 0;
  }

  .tool-row.off .tool-info {
    opacity: 0.55;
  }

  .tool-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .tool-policy {
    flex-shrink: 0;
    padding: 2px 6px;
    font-size: var(--jarvis-text-xs);
  }

  .tool-name {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--jarvis-text-sm);
  }

  .tool-desc {
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-descriptionForeground);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
