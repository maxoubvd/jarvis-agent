<script lang="ts">
  import type { ModelItem, ModelRole, ProviderType } from '../../shared/types';
  import { MODEL_ROLES, DEFAULT_BASE_URL, PROVIDER_KEY_PAGE } from '../../shared/types';
  import Icon from '../Icon.svelte';
  import Toggle from '../Toggle.svelte';

  interface Props {
    items?: ModelItem[];
    defaultModel?: string;
    onChange?: (next: ModelItem[]) => void;
    onDefaultChange?: (name: string) => void;
  }

  let {
    items = [],
    defaultModel = '',
    onChange = () => {},
    onDefaultChange = () => {}
  }: Props = $props();

  /** Ordre d'affichage du dropdown ; « autre » = openai-compatible. */
  const PROVIDER_OPTIONS: Array<{ value: ProviderType; label: string }> = [
    { value: 'mistral', label: 'mistral' },
    { value: 'openrouter', label: 'openrouter' },
    { value: 'openai', label: 'openai' },
    { value: 'anthropic', label: 'anthropic' },
    { value: 'gemini', label: 'gemini' },
    { value: 'sambanova', label: 'sambanova' },
    { value: 'ollama', label: 'ollama' },
    { value: 'lmstudio', label: 'lmstudio' },
    { value: 'huggingface', label: 'huggingface' },
    { value: 'openai-compatible', label: 'autre (openai-compatible)' }
  ];

  const MODEL_PLACEHOLDER: Partial<Record<ProviderType, string>> = {
    mistral: 'codestral-latest',
    openrouter: 'openai/gpt-oss-120b:free',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-5',
    gemini: 'gemini-2.0-flash',
    sambanova: 'Meta-Llama-3.3-70B-Instruct',
    ollama: 'qwen2.5-coder:7b',
    lmstudio: 'local-model',
    huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
    'openai-compatible': 'model-id'
  };

  /**
   * Cartes dépliées, indexées par position. Un nouvel item s'ouvre en mode
   * édition ; « Validate » replie la carte vers la vue liste.
   */
  let expanded = $state<Record<number, boolean>>({});

  function update(next: ModelItem[]) {
    onChange(next);
  }

  function addModel() {
    expanded[items.length] = true;
    update([
      ...items,
      {
        name: '',
        provider: 'openrouter',
        model: '',
        roles: ['chat', 'edit', 'apply'],
        contextLength: 32768
      }
    ]);
  }

  function removeModel(index: number) {
    const removed = items[index];
    // Les index changent après suppression — on replie tout pour rester cohérent.
    expanded = {};
    update(items.filter((_, i) => i !== index));
    if (removed?.name && removed.name === defaultModel) onDefaultChange('');
  }

  function patch(index: number, partial: Partial<ModelItem>) {
    update(items.map((m, i) => (i === index ? { ...m, ...partial } : m)));
  }

  function needsApiKey(provider: ProviderType): boolean {
    return provider !== 'ollama' && provider !== 'lmstudio';
  }

  function toggleRole(index: number, role: ModelRole, on: boolean) {
    const current = items[index].roles ?? [];
    patch(index, { roles: on ? [...current, role] : current.filter(r => r !== role) });
  }

  function parseOptionalNumber(value: string): number | undefined {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
  }

  function parseOptionalTemperature(value: string): number | undefined {
    const n = Number(value);
    return value.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 2 ? n : undefined;
  }

  /** Température par défaut du profil détecté (devstral/codestral 0.1, qwen-coder 0.15). */
  function profilePlaceholder(model: ModelItem): string {
    const haystack = `${model.model} ${model.name}`;
    if (/devstral|codestral/i.test(haystack)) return '0.1 (profile)';
    if (/qwen[^a-z0-9]*(2\.5|3)?[^a-z0-9]*coder|coder[^a-z0-9]*qwen/i.test(haystack)) return '0.15 (profile)';
    return 'API default';
  }

  function isDuplicateName(index: number): boolean {
    const name = items[index].name.trim();
    return !!name && items.some((m, i) => i !== index && m.name.trim() === name);
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="server" size={14} /> Models</h3>
    <button class="j-btn" onclick={addModel}><Icon name="add" size={13} /> Add model</button>
  </div>

  <p class="j-hint">
    Each model carries its own provider and API key. The token gauge uses the context length of
    the selected default model.
  </p>

  {#if items.length === 0}
    <div class="j-empty">No model yet. Add one to start chatting.</div>
  {/if}

  {#each items as model, index (index)}
    <div class="j-card" class:disabled={model.enabled === false}>
      <div class="j-row">
        <button
          class="j-expand"
          title={expanded[index] ? 'Collapse' : 'Edit model'}
          onclick={() => (expanded[index] = !expanded[index])}
        >
          <Icon name={expanded[index] ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        <span class="j-title">{model.name.trim() || '(unnamed model)'}</span>
        <span class="j-sub j-grow">{model.provider}{model.model ? ` · ${model.model}` : ''}</span>
        <Toggle
          checked={model.enabled !== false}
          label="Enabled"
          onchange={on => patch(index, { enabled: on ? undefined : false })}
        />
        <label class="default-radio" title="Set as default model">
          <input
            type="radio"
            name="default-model"
            checked={defaultModel === model.name && !!model.name.trim()}
            disabled={!model.name.trim()}
            onchange={() => onDefaultChange(model.name)}
          />
          default
        </label>
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removeModel(index)}>
          <Icon name="trash" size={13} />
        </button>
      </div>

      {#if isDuplicateName(index)}
        <div class="warn">Another model already uses this name.</div>
      {/if}

      {#if expanded[index]}
        <div class="j-row">
          <label class="j-field j-grow">
            <span>Display name</span>
            <input
              class="j-input"
              placeholder="e.g. GPT-OSS 120B"
              value={model.name}
              oninput={e => patch(index, { name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="j-field">
            <span>Provider</span>
            <select
              class="j-select"
              value={model.provider}
              onchange={e => patch(index, { provider: (e.target as HTMLSelectElement).value as ProviderType })}
            >
              {#each PROVIDER_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          </label>
        </div>

        {#if PROVIDER_KEY_PAGE[model.provider]}
          {@const keyPage = PROVIDER_KEY_PAGE[model.provider]}
          <!-- Les liens http(s) d'un webview s'ouvrent dans le navigateur externe. -->
          <a class="key-link" href={keyPage?.url} title={keyPage?.url}>
            <Icon name="globe" size={12} /> {keyPage?.label} — {model.provider}
          </a>
        {/if}

        <label class="j-field">
          <span>Model (API id)</span>
          <input
            class="j-input"
            placeholder={MODEL_PLACEHOLDER[model.provider] ?? 'model-id'}
            value={model.model}
            oninput={e => patch(index, { model: (e.target as HTMLInputElement).value })}
          />
        </label>

        {#if needsApiKey(model.provider)}
          <label class="j-field">
            <span>API key</span>
            <input
              class="j-input"
              type="password"
              autocomplete="off"
              placeholder="sk-…"
              value={model.apiKey ?? ''}
              oninput={e => patch(index, { apiKey: (e.target as HTMLInputElement).value || undefined })}
            />
          </label>
        {/if}

        <label class="j-field">
          <span>API base URL (optional)</span>
          <input
            class="j-input"
            placeholder={DEFAULT_BASE_URL[model.provider]}
            value={model.apiBase ?? ''}
            oninput={e => patch(index, { apiBase: (e.target as HTMLInputElement).value || undefined })}
          />
        </label>

        <div class="j-field">
          <span>Roles</span>
          <div class="j-row">
            {#each MODEL_ROLES as role (role)}
              <Toggle
                checked={(model.roles ?? []).includes(role)}
                label={role}
                onchange={on => toggleRole(index, role, on)}
              />
            {/each}
          </div>
        </div>

        <div class="j-row">
          <label class="j-field">
            <span>Context length</span>
            <input
              class="j-input num"
              type="number"
              min="1"
              placeholder="32768"
              value={model.contextLength ?? ''}
              oninput={e => patch(index, { contextLength: parseOptionalNumber((e.target as HTMLInputElement).value) })}
            />
          </label>
          <label class="j-field">
            <span>Max tokens (optional)</span>
            <input
              class="j-input num"
              type="number"
              min="1"
              placeholder="2048"
              value={model.maxTokens ?? ''}
              oninput={e => patch(index, { maxTokens: parseOptionalNumber((e.target as HTMLInputElement).value) })}
            />
          </label>
          <label class="j-field">
            <span>Temperature (optional)</span>
            <input
              class="j-input num"
              type="number"
              min="0"
              max="2"
              step="0.05"
              placeholder={profilePlaceholder(model)}
              value={model.temperature ?? ''}
              oninput={e => patch(index, { temperature: parseOptionalTemperature((e.target as HTMLInputElement).value) })}
            />
          </label>
        </div>

        <div class="j-row j-end">
          <button class="j-btn j-btn-primary" onclick={() => (expanded[index] = false)}>
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

  .warn {
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-terminal-ansiYellow);
  }

  .default-radio {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    font-size: var(--jarvis-text-xs);
    white-space: nowrap;
    cursor: pointer;
  }

  .default-radio input {
    accent-color: var(--jarvis-accent);
  }

  .num {
    width: 7rem;
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
