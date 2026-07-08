<script lang="ts">
  import type { ToolPolicy } from '../../shared/types';

  interface ToolInfo {
    name: string;
    description: string;
  }

  interface Props {
    /** Outils intégrés de l'agent (envoyés par le backend). */
    builtinTools?: ToolInfo[];
    /** Outils personnalisés jarvis-tools/*.json. */
    customTools?: ToolInfo[];
    /** Politique par nom d'outil ; absent = comportement du mode HITL. */
    policies?: Record<string, ToolPolicy>;
    onChange?: (next: Record<string, ToolPolicy>) => void;
  }

  let { builtinTools = [], customTools = [], policies = {}, onChange = () => {} }: Props = $props();

  const POLICY_OPTIONS: Array<{ value: ToolPolicy | ''; label: string }> = [
    { value: '', label: 'default (HITL mode)' },
    { value: 'auto', label: 'auto — no confirmation' },
    { value: 'ask', label: 'ask first — always confirm' },
    { value: 'excluded', label: 'excluded — hidden from the agent' }
  ];

  function setPolicy(name: string, value: string) {
    const next = { ...policies };
    if (value === 'auto' || value === 'ask' || value === 'excluded') next[name] = value;
    else delete next[name];
    onChange(next);
  }
</script>

{#snippet toolRows(tools: ToolInfo[])}
  {#each tools as tool (tool.name)}
    <div class="tool-row" class:off={policies[tool.name] === 'excluded'}>
      <div class="tool-info">
        <span class="tool-name">{tool.name}</span>
        <span class="tool-desc">{tool.description}</span>
      </div>
      <select
        class="j-select"
        value={policies[tool.name] ?? ''}
        onchange={e => setPolicy(tool.name, (e.target as HTMLSelectElement).value)}
      >
        {#each POLICY_OPTIONS as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
  {/each}
{/snippet}

<!-- Fragment embarqué dans la section « Tools & MCP Servers » (McpSection). -->
<p class="j-hint">
  Execution policy per agent tool. <strong>default</strong> follows the current HITL mode;
  <strong>auto</strong> never asks; <strong>ask first</strong> always asks (even in free mode);
  <strong>excluded</strong> hides the tool from the agent.
</p>

{#if builtinTools.length === 0 && customTools.length === 0}
  <div class="j-empty">No agent tools available.</div>
{/if}

{@render toolRows(builtinTools)}

{#if customTools.length > 0}
  <div class="subhead">Custom tools (jarvis-tools/*.json)</div>
  {@render toolRows(customTools)}
{/if}

<style>
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

  .tool-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--jarvis-space-1) var(--jarvis-space-2);
    padding: var(--jarvis-space-1) 0;
  }

  .tool-row.off .tool-info {
    opacity: 0.55;
  }

  .tool-info {
    /* En sidebar étroite, le select ne rentre plus sur la ligne et passe en
       dessous (flex-wrap) au lieu d'écraser/masquer la description. */
    flex: 1 1 55%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .tool-row .j-select {
    flex: 1 1 auto;
    min-width: 140px;
    max-width: 100%;
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
