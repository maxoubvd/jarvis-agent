// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

/**
 * Mock of acquireVsCodeApi installed BEFORE importing App (vscode-api.ts
 * captures the API on module load). Like real VS Code, postMessage
 * uses structured cloning: a residual $state proxy in the message
 * would crash the save (regression bug tested here).
 */
const posted = vi.hoisted(() => {
  const messages: Array<Record<string, unknown>> = [];
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage(message: unknown) {
      messages.push(structuredClone(message) as Record<string, unknown>);
    },
    getState() { return undefined; },
    setState() { /* no-op en test */ }
  });
  return messages;
});

import App from '../../src/frontend/App.svelte';

/**
 * Regression test for bug "clicking a light-switch in Settings breaks the entire
 * frontend": we open the Settings tab with a realistic config (as the
 * backend sends it), then we operate the toggles and expand buttons.
 */

function postToWebview(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

const DEFAULTS = {
  agents: [
    {
      id: 'qa',
      mention: '@QA-Agent',
      label: 'QA',
      description: 'tests',
      systemPrompt: 'You are QA',
      keywords: ['test']
    }
  ],
  workflows: [
    {
      id: 'dev-feature',
      label: 'Dev feature',
      description: 'feature workflow',
      steps: [{ name: 'plan', prompt: 'plan it' }]
    }
  ],
  builtinMcp: [
    { id: 'memory', label: 'Memory (Knowledge Graph)', description: 'kg', command: 'npx -y @modelcontextprotocol/server-memory', defaultEnabled: true },
    { id: 'filesystem', label: 'Filesystem', description: 'fs', command: 'npx -y @modelcontextprotocol/server-filesystem', defaultEnabled: true },
    { id: 'git', label: 'Git', description: 'git ops', command: 'uvx mcp-server-git', defaultEnabled: false },
    { id: 'fetch', label: 'Fetch (URL)', description: 'fetch', command: '(built-in)', defaultEnabled: true }
  ],
  agentTools: [
    { name: 'create_new_file', description: 'Creates or replaces a file' },
    { name: 'run_terminal_command', description: 'Executes a shell command' }
  ],
  customTools: []
};

const CONFIG = {
  version: 1,
  models: {
    default: 'GPT',
    items: [
      {
        name: 'GPT',
        provider: 'openrouter',
        model: 'openai/gpt-oss-120b:free',
        roles: ['chat', 'edit', 'apply'],
        contextLength: 32768
      }
    ]
  },
  optimization: {}
};

async function openSettingsWithConfig(defaults: typeof DEFAULTS = DEFAULTS) {
  render(App);
  await tick();
  // The backend pushes status + settings on webviewReady.
  postToWebview({ type: 'status', text: 'Connected — model: GPT', models: ['GPT'], model: 'GPT', needsSetup: false });
  postToWebview({ type: 'settings', config: CONFIG, defaults, currentFolder: 'C:\\proj', needsSetup: false });
  await tick();
  // Navigation is closed by default on open: we open it via the menu button.
  screen.getByRole('button', { name: /Toggle navigation/ }).click();
  await tick();
  // Navigate to Settings (sidebar inline, large viewport by default).
  const settingsTab = screen.getAllByRole('button', { name: /Settings/ }).at(-1)!;
  settingsTab.click();
  await tick();
  // The backend returns settings + mcpStatus when entering the tab.
  postToWebview({ type: 'settings', config: CONFIG, defaults, currentFolder: 'C:\\proj', needsSetup: false });
  postToWebview({
    type: 'mcpStatus',
    servers: [
      {
        name: 'memory',
        enabled: true,
        connected: true,
        tools: [{ name: 'create_entities', description: 'create', enabled: true, policy: 'ask' }]
      },
      { name: 'git', enabled: false, connected: false, tools: [] }
    ]
  });
  await tick();
}

beforeEach(() => {
  cleanup();
  posted.length = 0;
});

describe('settings panel interactions', () => {
  it('clicking the git Enabled toggle keeps the app responsive', async () => {
    await openSettingsWithConfig();

    const gitLabel = screen.getByText('Git');
    const card = gitLabel.closest('.j-card') as HTMLElement;
    expect(card).toBeTruthy();
    const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();

    checkbox.click();
    await tick();

    expect(checkbox.checked).toBe(true);

    // The app must still be responsive: the memory server expand button should work.
    const memoryCard = screen.getByText('Memory (Knowledge Graph)').closest('.j-card') as HTMLElement;
    const expandBtn = memoryCard.querySelector('.j-expand') as HTMLElement;
    expandBtn.click();
    await tick();
    expect(memoryCard.textContent).toContain('create_entities');
  });

  it('enabling git when the folder needs "git init" asks the backend instead of toggling locally', async () => {
    // Regression: the opened folder is not itself a git repository
    // (requiresGitInit) — clicking Enabled must NOT activate the toggle
    // directly, it must request from the backend the confirmation flow +
    // git init (message `requestGitInit`), which will refresh settings/mcpStatus
    // once done.
    const defaultsNeedsGitInit = {
      ...DEFAULTS,
      builtinMcp: DEFAULTS.builtinMcp.map(b =>
        b.id === 'git' ? { ...b, requiresGitInit: true } : b
      )
    };
    await openSettingsWithConfig(defaultsNeedsGitInit);

    const gitLabel = screen.getByText('Git');
    const card = gitLabel.closest('.j-card') as HTMLElement;
    const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement;

    checkbox.click();
    await tick();

    // No optimistic toggle: the backend confirms/refuses before any visible change.
    expect(checkbox.checked).toBe(false);
    expect(posted.some(m => m.type === 'requestGitInit' && m.id === 'git')).toBe(true);
    // And above all: no silent save of the config with git enabled.
    expect(posted.some(m => m.type === 'updateSettings')).toBe(false);
  });

  it('clicking a model role toggle keeps the app responsive', async () => {
    await openSettingsWithConfig();

    // Model cards are collapsed by default — we expand the GPT card.
    // (getAllByText: "GPT" also appears in the model selector in the header.)
    const title = screen.getAllByText('GPT').find(el => el.classList.contains('j-title'))!;
    const modelCard = title.closest('.j-card') as HTMLElement;
    (modelCard.querySelector('.j-expand') as HTMLElement).click();
    await tick();

    const roleToggle = screen.getByText('autocomplete').closest('label') as HTMLElement;
    const checkbox = roleToggle.querySelector('input') as HTMLInputElement;
    checkbox.click();
    await tick();
    expect(checkbox.checked).toBe(true);
  });

  it('Add model opens an editor; Validate collapses it back to the list', async () => {
    await openSettingsWithConfig();

    screen.getByRole('button', { name: /Add model/ }).click();
    await tick();

    // The new card is opened in edit mode (name placeholder visible),
    // with the link to the API key page of the default provider (mistral).
    expect(screen.getByText(/Get API key — mistral/)).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('e.g. GPT-OSS 120B') as HTMLInputElement;
    nameInput.value = 'Mistral';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    screen.getByRole('button', { name: /Validate/ }).click();
    await tick();

    // The card is collapsed: the form disappears, the item remains listed
    // with its Enabled light-switch.
    expect(screen.queryByPlaceholderText('e.g. GPT-OSS 120B')).toBeNull();
    const card = screen.getByText('Mistral').closest('.j-card') as HTMLElement;
    const toggle = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(true);
  });

  it('Save posts a structured-cloneable config (rules + models survive postMessage)', async () => {
    await openSettingsWithConfig();

    // Add a rule (opened in edit mode) and fill its content.
    screen.getByRole('button', { name: /Add rule/ }).click();
    await tick();
    const ruleContent = screen.getByPlaceholderText(/Always write tests/) as HTMLTextAreaElement;
    ruleContent.value = 'Respond in English';
    ruleContent.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    // Save — postMessage clones the config: must not throw (proxies $state).
    const saveBtn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await tick();

    const update = posted.find(m => m.type === 'updateSettings') as
      | { config?: { rules?: Array<{ content: string }>; models?: { items: Array<{ name: string }> } } }
      | undefined;
    expect(update).toBeTruthy();
    expect(update?.config?.rules?.[0]?.content).toBe('Respond in English');
    expect(update?.config?.models?.items?.[0]?.name).toBe('GPT');

    // Feedback: "Saving..." immediately, then "Saved checkmark" on backend ack.
    expect(screen.getByRole('status').textContent).toContain('Saving…');
    postToWebview({ type: 'settingsSaved', ok: true });
    await tick();
    expect(screen.getByRole('status').textContent).toContain('Saved ✓');
  });

  it('tool policies (auto/ask/excluded) are edited and saved', async () => {
    await openSettingsWithConfig();

    // The Tools section lists the built-in tools with their policy select.
    const row = screen.getByText('run_terminal_command').closest('.tool-row') as HTMLElement;
    const select = row.querySelector('select') as HTMLSelectElement;
    select.value = 'ask';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).click();
    await tick();

    const update = posted.find(m => m.type === 'updateSettings') as
      | { config?: { toolPolicies?: Record<string, string> } }
      | undefined;
    expect(update?.config?.toolPolicies).toEqual({ run_terminal_command: 'ask' });
  });

  it('MCP tool policies default to ask first and are saved per server', async () => {
    await openSettingsWithConfig();

    // Expands the memory server card to list its tools.
    const memoryCard = screen.getByText('Memory (Knowledge Graph)').closest('.j-card') as HTMLElement;
    (memoryCard.querySelector('.j-expand') as HTMLElement).click();
    await tick();

    const row = screen.getByText('create_entities').closest('.tool-row') as HTMLElement;
    const select = row.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('ask');

    select.value = 'auto';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();

    (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).click();
    await tick();

    const update = posted.find(m => m.type === 'updateSettings') as
      | { config?: { builtinMcp?: Record<string, { toolPolicies?: Record<string, string> }> } }
      | undefined;
    expect(update?.config?.builtinMcp?.memory?.toolPolicies).toEqual({ create_entities: 'auto' });
  });
});
