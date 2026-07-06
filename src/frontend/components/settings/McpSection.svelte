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
  import type { McpServerStatus, SettingsDefaults } from '../../shared/types';
  import Icon from '../Icon.svelte';
  import Toggle from '../Toggle.svelte';

  interface Props {
    builtins?: NonNullable<SettingsDefaults['builtinMcp']>;
    builtinToggles?: Record<string, boolean>;
    builtinDisabledTools?: Record<string, string[]>;
    entries?: McpEntry[];
    statuses?: McpServerStatus[];
    customTools?: Array<{ name: string; description: string }>;
    onBuiltinToggle?: (id: string, enabled: boolean) => void;
    onBuiltinToolToggle?: (id: string, tool: string, enabled: boolean) => void;
    onEntriesChange?: (next: McpEntry[]) => void;
  }

  let {
    builtins = [],
    builtinToggles = {},
    builtinDisabledTools = {},
    entries = [],
    statuses = [],
    customTools = [],
    onBuiltinToggle = () => {},
    onBuiltinToolToggle = () => {},
    onEntriesChange = () => {}
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
    onEntriesChange([
      ...entries,
      { key, value: { enabled: true, transport: 'stdio', command: '' }, argsText: '', envText: '' }
    ]);
  }

  function removeServer(index: number) {
    onEntriesChange(entries.filter((_, i) => i !== index));
  }

  function patchEntry(index: number, partial: Partial<McpEntry>) {
    onEntriesChange(entries.map((e, i) => (i === index ? { ...e, ...partial } : e)));
  }

  function patchEntryValue(index: number, partial: Partial<McpServerConfig>) {
    patchEntry(index, { value: { ...entries[index].value, ...partial } });
  }

  function toggleEntryTool(index: number, tool: string, enabled: boolean) {
    const current = entries[index].value.disabledTools ?? [];
    const next = enabled ? current.filter(t => t !== tool) : [...current, tool];
    patchEntryValue(index, { disabledTools: next.length > 0 ? next : undefined });
  }

  function isBuiltinToolEnabled(id: string, tool: string): boolean {
    return !(builtinDisabledTools[id] ?? []).includes(tool);
  }

  function isEntryToolEnabled(entry: McpEntry, tool: string): boolean {
    return !(entry.value.disabledTools ?? []).includes(tool);
  }
</script>

{#snippet toolList(
  status: McpServerStatus | undefined,
  serverEnabled: boolean,
  isToolEnabled: (tool: string) => boolean,
  onToolToggle: (tool: string, enabled: boolean) => void
)}
  {#if status?.connected && status.tools.length > 0}
    <div class="tools">
      {#each status.tools as tool (tool.name)}
        <div class="tool-row" class:off={!isToolEnabled(tool.name)}>
          <Toggle
            checked={isToolEnabled(tool.name)}
            onchange={on => onToolToggle(tool.name, on)}
            title={`Enable/disable ${tool.name}`}
          />
          <div class="tool-info">
            <span class="tool-name">{tool.name}</span>
            {#if tool.description}
              <span class="tool-desc">{tool.description}</span>
            {/if}
          </div>
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
    <h3><Icon name="server" size={14} /> MCP Servers</h3>
    <button class="j-btn" onclick={addServer}><Icon name="add" size={13} /> Add server</button>
  </div>

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
            class="expand-btn"
            title={expanded[builtin.id] ? 'Collapse' : 'Expand tools'}
            onclick={() => toggleExpanded(builtin.id)}
          >
            <Icon name={expanded[builtin.id] ? 'chevron-up' : 'chevron-down'} size={13} />
          </button>
          <span class="server-label">{builtin.label}</span>
          <Toggle
            checked={enabled}
            label="Enabled"
            onchange={on => onBuiltinToggle(builtin.id, on)}
          />
          {@render statusBadge(status)}
        </div>
        <div class="server-desc">{builtin.description}</div>
        <code class="server-cmd">{builtin.command}</code>
        {#if expanded[builtin.id]}
          {@render toolList(
            status,
            enabled,
            tool => isBuiltinToolEnabled(builtin.id, tool),
            (tool, on) => onBuiltinToolToggle(builtin.id, tool, on)
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
          class="expand-btn"
          title={expanded[`custom:${sIndex}`] ? 'Collapse' : 'Expand tools'}
          onclick={() => toggleExpanded(`custom:${sIndex}`)}
        >
          <Icon name={expanded[`custom:${sIndex}`] ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        <input
          class="j-input j-grow"
          placeholder="server id"
          value={entry.key}
          oninput={e => patchEntry(sIndex, { key: (e.target as HTMLInputElement).value })}
        />
        {#if builtins.some(b => b.id === entry.key.trim())}
          <span class="mcp-status ko">shadows the “{entry.key.trim()}” built-in server</span>
        {/if}
        <select
          class="j-select"
          value={entry.value.transport}
          onchange={e =>
            patchEntryValue(sIndex, { transport: (e.target as HTMLSelectElement).value as 'stdio' | 'sse' })}
        >
          <option value="stdio">stdio</option>
          <option value="sse">sse</option>
        </select>
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

      {#if expanded[`custom:${sIndex}`]}
        {@render toolList(
          status,
          entry.value.enabled,
          tool => isEntryToolEnabled(entry, tool),
          (tool, on) => toggleEntryTool(sIndex, tool, on)
        )}
      {/if}
    </div>
  {/each}

  {#if customTools.length > 0}
    <div class="subhead">Custom tools (jarvis-tools/*.json)</div>
    <p class="j-hint">Defined in the workspace <code>jarvis-tools/</code> folder — edit the files to change them.</p>
    <div class="tools">
      {#each customTools as tool (tool.name)}
        <div class="tool-row">
          <div class="tool-info">
            <span class="tool-name">{tool.name}</span>
            {#if tool.description}
              <span class="tool-desc">{tool.description}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
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

  .expand-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    background: transparent;
    border: none;
    border-radius: var(--jarvis-radius-sm);
    color: inherit;
    cursor: pointer;
    transition: background var(--jarvis-transition);
  }

  .expand-btn:hover {
    background: var(--vscode-list-hoverBackground);
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
    display: flex;
    flex-direction: column;
    min-width: 0;
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
