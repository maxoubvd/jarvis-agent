// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

/**
 * Mock d'acquireVsCodeApi installé AVANT l'import de l'App (vscode-api.ts
 * capture l'API au chargement du module). Comme le vrai VS Code, postMessage
 * passe par le clonage structuré : un proxy $state résiduel dans le message
 * ferait planter la sauvegarde (bug régressé ici).
 */
const posted = vi.hoisted(() => {
  const messages: Array<Record<string, unknown>> = [];
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage(message: unknown) {
      messages.push(structuredClone(message) as Record<string, unknown>);
    }
  });
  return messages;
});

import App from '../../src/frontend/App.svelte';

/**
 * Régression du bug « cliquer un light-switch dans les Settings casse tout le
 * front » : on ouvre l'onglet Settings avec une config réaliste (comme le
 * backend l'envoie), puis on actionne les toggles et les boutons expand.
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
    { name: 'create_new_file', description: 'Crée ou remplace un fichier' },
    { name: 'run_terminal_command', description: 'Exécute une commande shell' }
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

async function openSettingsWithConfig() {
  render(App);
  await tick();
  // Le backend pousse status + settings au webviewReady.
  postToWebview({ type: 'status', text: 'Connected — model: GPT', models: ['GPT'], model: 'GPT', needsSetup: false });
  postToWebview({ type: 'settings', config: CONFIG, defaults: DEFAULTS, currentFolder: 'C:\\proj', needsSetup: false });
  await tick();
  // Naviguer vers Settings (sidebar inline, viewport large par défaut).
  const settingsTab = screen.getAllByRole('button', { name: /Settings/ }).at(-1)!;
  settingsTab.click();
  await tick();
  // Le backend renvoie settings + mcpStatus quand on entre dans l'onglet.
  postToWebview({ type: 'settings', config: CONFIG, defaults: DEFAULTS, currentFolder: 'C:\\proj', needsSetup: false });
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

    // L'app doit encore réagir : le bouton expand du serveur memory doit fonctionner.
    const memoryCard = screen.getByText('Memory (Knowledge Graph)').closest('.j-card') as HTMLElement;
    const expandBtn = memoryCard.querySelector('.j-expand') as HTMLElement;
    expandBtn.click();
    await tick();
    expect(memoryCard.textContent).toContain('create_entities');
  });

  it('clicking a model role toggle keeps the app responsive', async () => {
    await openSettingsWithConfig();

    // Les cartes modèles sont repliées par défaut — on déplie la carte GPT.
    // (getAllByText : « GPT » apparaît aussi dans le sélecteur de modèle du header.)
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

    // La nouvelle carte est ouverte en édition (placeholder du nom visible),
    // avec le lien vers la page de clé API du provider sélectionné.
    expect(screen.getByText(/Get API key — openrouter/)).toBeTruthy();
    const nameInput = screen.getByPlaceholderText('e.g. GPT-OSS 120B') as HTMLInputElement;
    nameInput.value = 'Mistral';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    screen.getByRole('button', { name: /Validate/ }).click();
    await tick();

    // La carte est repliée : le formulaire disparaît, l'item reste listé
    // avec son light-switch Enabled.
    expect(screen.queryByPlaceholderText('e.g. GPT-OSS 120B')).toBeNull();
    const card = screen.getByText('Mistral').closest('.j-card') as HTMLElement;
    const toggle = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(toggle).toBeTruthy();
    expect(toggle.checked).toBe(true);
  });

  it('Save posts a structured-cloneable config (rules + models survive postMessage)', async () => {
    await openSettingsWithConfig();

    // Ajoute une rule (ouverte en édition) et remplit son contenu.
    screen.getByRole('button', { name: /Add rule/ }).click();
    await tick();
    const ruleContent = screen.getByPlaceholderText(/Always write tests/) as HTMLTextAreaElement;
    ruleContent.value = 'Réponds en français';
    ruleContent.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    // Save — postMessage clone la config : ne doit pas jeter (proxies $state).
    const saveBtn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    saveBtn.click();
    await tick();

    const update = posted.find(m => m.type === 'updateSettings') as
      | { config?: { rules?: Array<{ content: string }>; models?: { items: Array<{ name: string }> } } }
      | undefined;
    expect(update).toBeTruthy();
    expect(update?.config?.rules?.[0]?.content).toBe('Réponds en français');
    expect(update?.config?.models?.items?.[0]?.name).toBe('GPT');

    // Feedback : « Saving… » immédiat, puis « Saved ✓ » à l'ack du backend.
    expect(screen.getByRole('status').textContent).toContain('Saving…');
    postToWebview({ type: 'settingsSaved', ok: true });
    await tick();
    expect(screen.getByRole('status').textContent).toContain('Saved ✓');
  });

  it('tool policies (auto/ask/excluded) are edited and saved', async () => {
    await openSettingsWithConfig();

    // La section Tools liste les outils intégrés avec leur select de politique.
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

    // Déplie la carte du serveur memory pour lister ses tools.
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
