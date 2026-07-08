<script lang="ts">
  import { untrack } from 'svelte';
  import type { JarvisConfig, ModelItem, ProviderType } from '../shared/types';
  import { DEFAULT_BASE_URL, PROVIDER_KEY_PAGE } from '../shared/types';
  import Icon from './Icon.svelte';

  interface ConnectionResult {
    ok: boolean;
    error?: string;
    sample?: string;
  }

  interface Props {
    /** Config existante (pour ne pas écraser les autres réglages en sauvegardant). */
    baseConfig?: JarvisConfig | null;
    /** Un modèle est déjà configuré → on démarre directement sur le tour. */
    hasModel?: boolean;
    connectionResult?: ConnectionResult | null;
    testing?: boolean;
    onTest?: (item: ModelItem) => void;
    onSave?: (config: JarvisConfig) => void;
    onComplete?: () => void;
  }

  let {
    baseConfig = null,
    hasModel = false,
    connectionResult = null,
    testing = false,
    onTest = () => {},
    onSave = () => {},
    onComplete = () => {}
  }: Props = $props();

  /** 1 = provider, 2 = test/validation, 3 = tour des features (capture initiale). */
  let step = $state(untrack(() => hasModel) ? 3 : 1);

  const PROVIDERS: Array<{ value: ProviderType; label: string; blurb: string; local?: boolean; modelPlaceholder: string }> = [
    { value: 'ollama', label: 'Ollama', blurb: 'Local · gratuit · privé', local: true, modelPlaceholder: 'qwen2.5-coder:7b' },
    { value: 'openrouter', label: 'OpenRouter', blurb: 'Des centaines de modèles, une clé', modelPlaceholder: 'deepseek/deepseek-chat' },
    { value: 'openai', label: 'OpenAI', blurb: 'GPT-4o · GPT-4o-mini', modelPlaceholder: 'gpt-4o-mini' },
    { value: 'anthropic', label: 'Anthropic', blurb: 'Claude Sonnet / Haiku', modelPlaceholder: 'claude-sonnet-4-5' },
    { value: 'mistral', label: 'Mistral', blurb: 'Codestral · Mistral Large', modelPlaceholder: 'codestral-latest' },
    { value: 'lmstudio', label: 'LM Studio', blurb: 'Local · serveur OpenAI', local: true, modelPlaceholder: 'local-model' }
  ];

  let provider = $state<ProviderType>('ollama');
  let modelId = $state('');
  let apiKey = $state('');
  let apiBase = $state('');

  const selectedMeta = $derived(PROVIDERS.find(p => p.value === provider));
  const isLocal = $derived(selectedMeta?.local ?? false);
  const keyPage = $derived(PROVIDER_KEY_PAGE[provider]);
  const effectiveModel = $derived(modelId.trim() || (selectedMeta?.modelPlaceholder ?? ''));
  const canProceed = $derived(!!effectiveModel && (isLocal || apiKey.trim().length > 0));

  function selectProvider(p: ProviderType) {
    provider = p;
    apiKey = '';
    apiBase = '';
  }

  function buildItem(): ModelItem {
    return {
      name: `${selectedMeta?.label ?? provider} · ${effectiveModel}`,
      provider,
      model: effectiveModel,
      apiKey: apiKey.trim() || undefined,
      apiBase: apiBase.trim() || undefined,
      roles: ['chat', 'edit', 'apply'],
      contextLength: 32768
    };
  }

  function handleTest() {
    onTest(buildItem());
  }

  function handleSaveAndContinue() {
    const item = buildItem();
    const base: JarvisConfig = baseConfig ?? { version: 1, models: { default: null, items: [] } };
    const config: JarvisConfig = {
      ...base,
      models: {
        default: item.name,
        items: [...base.models.items.filter(m => m.name !== item.name), item]
      }
    };
    onSave(config);
    step = 3;
  }

  // --- Tour des features ---
  const SLIDES = [
    {
      icon: 'chat',
      title: 'Le Chat agentique',
      body: 'Décrivez ce que vous voulez en langage naturel. Jarvis lit vos fichiers, écrit du code, lance des commandes et valide ses résultats — étape par étape, avec votre accord (HITL).'
    },
    {
      icon: 'tools',
      title: 'Édition inline · Cmd+K',
      body: 'Sélectionnez du code dans l’éditeur puis Ctrl+K Ctrl+K. Donnez une instruction (« ajoute un try/catch ») : la modification s’applique sur place avec des boutons Accept / Reject.'
    },
    {
      icon: 'book',
      title: 'Le contexte avec @mentions',
      body: 'Tapez @file:src/index.ts pour injecter un fichier, ou @docs:… pour une recherche sémantique (RAG local). Jarvis répond avec le bon contexte, sans copier-coller.'
    }
  ];
  let slide = $state(0);
</script>

<div class="welcome">
  <div class="welcome-card">
    <header class="wh">
      <div class="logo"><Icon name="chat" size={22} /></div>
      <div>
        <h1>Bienvenue dans Jarvis</h1>
        <p class="sub">Votre pair-programmeur IA, directement dans VS Code.</p>
      </div>
    </header>

    <ol class="steps" aria-hidden="true">
      <li class:active={step >= 1} class:done={step > 1}>1 · Provider</li>
      <li class:active={step >= 2} class:done={step > 2}>2 · Connexion</li>
      <li class:active={step >= 3}>3 · Tour</li>
    </ol>

    {#if step === 1}
      <div class="body">
        <h2>Choisissez un fournisseur de modèle</h2>
        <div class="provider-grid">
          {#each PROVIDERS as p (p.value)}
            <button class="provider-card" class:selected={provider === p.value} onclick={() => selectProvider(p.value)}>
              <span class="pc-name">{p.label}{#if p.local}<span class="pill">local</span>{/if}</span>
              <span class="pc-blurb">{p.blurb}</span>
            </button>
          {/each}
        </div>

        <label class="field">
          <span>Modèle</span>
          <input class="j-input" placeholder={selectedMeta?.modelPlaceholder} bind:value={modelId} />
        </label>

        {#if !isLocal}
          <label class="field">
            <span>Clé API</span>
            <input class="j-input" type="password" autocomplete="off" placeholder="sk-…" bind:value={apiKey} />
          </label>
          {#if keyPage}
            <a class="key-link" href={keyPage.url}><Icon name="globe" size={12} /> {keyPage.label}</a>
          {/if}
        {:else}
          <p class="hint">
            Démarrez le serveur local (ex. <code>ollama run {selectedMeta?.modelPlaceholder}</code>). Aucune clé nécessaire.
          </p>
        {/if}

        <label class="field">
          <span>URL de base <em>(optionnel)</em></span>
          <input class="j-input" placeholder={DEFAULT_BASE_URL[provider]} bind:value={apiBase} />
        </label>

        <div class="actions">
          <button class="link-btn" onclick={onComplete}>Passer</button>
          <button class="primary" disabled={!canProceed} onclick={() => (step = 2)}>Continuer</button>
        </div>
      </div>

    {:else if step === 2}
      <div class="body">
        <h2>Vérifions la connexion</h2>
        <div class="recap">
          <span><strong>{selectedMeta?.label}</strong> · {effectiveModel}</span>
          <button class="link-btn" onclick={() => (step = 1)}>Modifier</button>
        </div>

        <button class="primary wide" disabled={testing} onclick={handleTest}>
          {#if testing}Test en cours…{:else}Tester la connexion{/if}
        </button>

        {#if connectionResult}
          {#if connectionResult.ok}
            <div class="result ok"><Icon name="check" size={14} /> Connexion réussie. Le modèle répond.</div>
          {:else}
            <div class="result err"><Icon name="warning" size={14} /> Échec : {connectionResult.error}</div>
          {/if}
        {/if}

        <div class="actions">
          <button class="link-btn" onclick={onComplete}>Passer</button>
          <button class="primary" onclick={handleSaveAndContinue}>Enregistrer et continuer</button>
        </div>
      </div>

    {:else}
      <div class="body tour">
        <div class="slide">
          <div class="slide-icon"><Icon name={SLIDES[slide].icon} size={26} /></div>
          <h2>{SLIDES[slide].title}</h2>
          <p>{SLIDES[slide].body}</p>
        </div>

        <div class="dots">
          {#each SLIDES as _, i (i)}
            <button class="dot" class:active={i === slide} aria-label={`Slide ${i + 1}`} onclick={() => (slide = i)}></button>
          {/each}
        </div>

        <div class="actions">
          {#if slide > 0}
            <button class="link-btn" onclick={() => (slide -= 1)}>Précédent</button>
          {:else}
            <span></span>
          {/if}
          {#if slide < SLIDES.length - 1}
            <button class="primary" onclick={() => (slide += 1)}>Suivant</button>
          {:else}
            <button class="primary" onclick={onComplete}>Commencer à coder</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .welcome {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    height: 100%;
    overflow: auto;
    padding: var(--jarvis-space-4, 1.25rem);
    box-sizing: border-box;
  }

  .welcome-card {
    width: 100%;
    max-width: 480px;
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-3, 0.9rem);
  }

  .wh {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--jarvis-radius-md, 10px);
    background: var(--jarvis-accent, var(--vscode-button-background));
    color: var(--jarvis-accent-fg, var(--vscode-button-foreground));
  }

  h1 {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .sub {
    margin: 0.15rem 0 0;
    font-size: var(--jarvis-text-sm, 0.85rem);
    color: var(--vscode-descriptionForeground);
  }

  .steps {
    display: flex;
    gap: 0.4rem;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: var(--jarvis-text-xs, 0.72rem);
  }

  .steps li {
    flex: 1;
    text-align: center;
    padding: 0.3rem 0;
    border-radius: var(--jarvis-radius-pill, 999px);
    background: var(--vscode-editorWidget-background);
    color: var(--vscode-descriptionForeground);
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .steps li.active {
    color: var(--vscode-editor-foreground);
    border-color: var(--jarvis-accent, var(--vscode-focusBorder));
  }

  .steps li.done {
    color: var(--vscode-terminal-ansiGreen);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .provider-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.5rem;
  }

  .provider-card {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.6rem 0.7rem;
    text-align: left;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-md, 8px);
    cursor: pointer;
    color: inherit;
    transition: border-color var(--jarvis-transition, 0.15s);
  }

  .provider-card:hover {
    border-color: var(--jarvis-accent, var(--vscode-focusBorder));
  }

  .provider-card.selected {
    border-color: var(--jarvis-accent, var(--vscode-focusBorder));
    box-shadow: inset 0 0 0 1px var(--jarvis-accent, var(--vscode-focusBorder));
  }

  .pc-name {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 600;
    font-size: var(--jarvis-text-sm, 0.85rem);
  }

  .pc-blurb {
    font-size: var(--jarvis-text-xs, 0.72rem);
    color: var(--vscode-descriptionForeground);
  }

  .pill {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: var(--jarvis-text-sm, 0.85rem);
  }

  .field span em {
    color: var(--vscode-descriptionForeground);
    font-style: normal;
  }

  .j-input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4rem 0.55rem;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
    border-radius: var(--jarvis-radius-sm, 6px);
    font-family: inherit;
    font-size: var(--jarvis-text-sm, 0.85rem);
  }

  .hint {
    margin: 0;
    font-size: var(--jarvis-text-xs, 0.72rem);
    color: var(--vscode-descriptionForeground);
    line-height: 1.5;
  }

  .hint code {
    padding: 0.05rem 0.3rem;
    border-radius: 4px;
    background: var(--vscode-textCodeBlock-background, var(--vscode-editorWidget-background));
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .key-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--jarvis-text-xs, 0.72rem);
    color: var(--vscode-textLink-foreground, var(--jarvis-accent));
    text-decoration: none;
  }

  .key-link:hover {
    text-decoration: underline;
  }

  .recap {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-editorWidget-border);
    border-radius: var(--jarvis-radius-sm, 6px);
    font-size: var(--jarvis-text-sm, 0.85rem);
  }

  .result {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.5rem 0.7rem;
    border-radius: var(--jarvis-radius-sm, 6px);
    font-size: var(--jarvis-text-sm, 0.85rem);
  }

  .result.ok {
    background: var(--vscode-inputValidation-infoBackground, rgba(0, 128, 0, 0.12));
    color: var(--vscode-terminal-ansiGreen);
  }

  .result.err {
    background: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
    color: var(--vscode-errorForeground);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 0.3rem;
  }

  .primary {
    padding: 0.45rem 1rem;
    background: var(--jarvis-accent, var(--vscode-button-background));
    color: var(--jarvis-accent-fg, var(--vscode-button-foreground));
    border: none;
    border-radius: var(--jarvis-radius-pill, 999px);
    cursor: pointer;
    font-size: var(--jarvis-text-sm, 0.85rem);
    font-weight: 600;
  }

  .primary.wide {
    width: 100%;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .primary:not(:disabled):hover {
    background: var(--jarvis-accent-hover, var(--vscode-button-hoverBackground));
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: var(--jarvis-text-sm, 0.85rem);
    padding: 0.3rem 0.2rem;
  }

  .link-btn:hover {
    color: var(--vscode-editor-foreground);
    text-decoration: underline;
  }

  .tour .slide {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.5rem;
    padding: 1rem 0.5rem 0.4rem;
  }

  .slide-icon {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: var(--vscode-editorWidget-background);
    color: var(--jarvis-accent, var(--vscode-focusBorder));
  }

  .tour .slide p {
    margin: 0;
    font-size: var(--jarvis-text-sm, 0.85rem);
    line-height: 1.55;
    color: var(--vscode-descriptionForeground);
    max-width: 34ch;
  }

  .dots {
    display: flex;
    justify-content: center;
    gap: 0.35rem;
  }

  .dot {
    width: 7px;
    height: 7px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--vscode-editorWidget-border);
    cursor: pointer;
  }

  .dot.active {
    background: var(--jarvis-accent, var(--vscode-focusBorder));
  }
</style>
