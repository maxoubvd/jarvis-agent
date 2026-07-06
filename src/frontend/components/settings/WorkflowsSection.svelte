<script lang="ts">
  import type { Workflow } from '../../shared/types';
  import Icon from '../Icon.svelte';

  interface Props {
    items?: Workflow[];
    defaults?: Workflow[];
    onChange?: (next: Workflow[]) => void;
  }

  let { items = [], defaults = [], onChange = () => {} }: Props = $props();

  function update(next: Workflow[]) {
    onChange(next);
  }

  function addWorkflow() {
    update([
      ...items,
      {
        id: `workflow-${items.length + 1}`,
        label: 'New workflow',
        description: '',
        steps: [{ name: 'Step 1', prompt: '{task}' }]
      }
    ]);
  }

  function removeWorkflow(index: number) {
    update(items.filter((_, i) => i !== index));
  }

  function patch(index: number, partial: Partial<Workflow>) {
    update(items.map((w, i) => (i === index ? { ...w, ...partial } : w)));
  }

  function patchStep(wIndex: number, sIndex: number, partial: Partial<Workflow['steps'][number]>) {
    const wf = items[wIndex];
    patch(wIndex, {
      steps: wf.steps.map((s, i) => (i === sIndex ? { ...s, ...partial } : s))
    });
  }

  function addStep(wIndex: number) {
    const wf = items[wIndex];
    patch(wIndex, { steps: [...wf.steps, { name: `Step ${wf.steps.length + 1}`, prompt: '' }] });
  }

  function removeStep(wIndex: number, sIndex: number) {
    const wf = items[wIndex];
    patch(wIndex, { steps: wf.steps.filter((_, i) => i !== sIndex) });
  }

  function moveStep(wIndex: number, sIndex: number, delta: number) {
    const wf = items[wIndex];
    const target = sIndex + delta;
    if (target < 0 || target >= wf.steps.length) return;
    const steps = [...wf.steps];
    [steps[sIndex], steps[target]] = [steps[target], steps[sIndex]];
    patch(wIndex, { steps });
  }

  function resetToDefaults() {
    update(structuredClone(defaults));
  }

  function isDuplicateId(id: string, index: number): boolean {
    return items.some((w, i) => i !== index && w.id === id);
  }
</script>

<div class="group j-group">
  <div class="group-head j-row">
    <h3><Icon name="graph" size={14} /> Workflows</h3>
    <div class="j-row">
      <button class="j-btn" onclick={resetToDefaults}>Reset to defaults</button>
      <button class="j-btn" onclick={addWorkflow}><Icon name="add" size={13} /> Add workflow</button>
    </div>
  </div>

  <p class="j-hint">
    Sequential step lists run with <code>/workflow &lt;id&gt; &lt;task&gt;</code>. In step prompts,
    <code>{'{task}'}</code> is replaced by the user task and <code>{'{previous}'}</code> by the
    previous step's result.
  </p>

  {#if items.length === 0}
    <div class="j-empty">No workflows. "Reset to defaults" restores the built-in workflows.</div>
  {/if}

  {#each items as workflow, wIndex (wIndex)}
    <div class="j-card">
      <div class="j-row">
        <input
          class="j-input"
          style="width: 9rem"
          placeholder="workflow-id"
          value={workflow.id}
          oninput={e => patch(wIndex, { id: (e.target as HTMLInputElement).value })}
        />
        <input
          class="j-input j-grow"
          placeholder="Label"
          value={workflow.label}
          oninput={e => patch(wIndex, { label: (e.target as HTMLInputElement).value })}
        />
        <button class="j-btn j-btn-danger j-btn-icon" title="Remove" onclick={() => removeWorkflow(wIndex)}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      {#if isDuplicateId(workflow.id, wIndex)}
        <div class="warn">Duplicate workflow id.</div>
      {/if}
      <label class="j-field">
        <span>Description</span>
        <input
          class="j-input"
          value={workflow.description}
          oninput={e => patch(wIndex, { description: (e.target as HTMLInputElement).value })}
        />
      </label>

      <div class="steps">
        <div class="steps-head j-row">
          <span class="steps-title">Steps</span>
          <button class="j-btn" onclick={() => addStep(wIndex)}>
            <Icon name="add" size={13} /> Add step
          </button>
        </div>
        {#each workflow.steps as step, sIndex (sIndex)}
          <div class="step">
            <div class="j-row">
              <input
                class="j-input j-grow"
                placeholder="Step name"
                value={step.name}
                oninput={e => patchStep(wIndex, sIndex, { name: (e.target as HTMLInputElement).value })}
              />
              <button
                class="j-btn j-btn-icon"
                title="Move up"
                disabled={sIndex === 0}
                onclick={() => moveStep(wIndex, sIndex, -1)}
              >
                <Icon name="chevron-up" size={13} />
              </button>
              <button
                class="j-btn j-btn-icon"
                title="Move down"
                disabled={sIndex === workflow.steps.length - 1}
                onclick={() => moveStep(wIndex, sIndex, 1)}
              >
                <Icon name="chevron-down" size={13} />
              </button>
              <button
                class="j-btn j-btn-danger j-btn-icon"
                title="Remove step"
                onclick={() => removeStep(wIndex, sIndex)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
            <textarea
              class="j-textarea"
              rows="2"
              placeholder="Prompt — use &#123;task&#125; and &#123;previous&#125;"
              value={step.prompt}
              oninput={e => patchStep(wIndex, sIndex, { prompt: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
          </div>
        {/each}
      </div>
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

  code {
    font-family: var(--vscode-editor-font-family, monospace);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-2);
    border-top: 1px dashed var(--vscode-editorWidget-border);
    padding-top: var(--jarvis-space-2);
  }

  .steps-head {
    justify-content: space-between;
  }

  .steps-title {
    font-size: var(--jarvis-text-xs);
    text-transform: uppercase;
    color: var(--vscode-descriptionForeground);
    letter-spacing: 0.04em;
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--jarvis-space-1);
  }

  .warn {
    font-size: var(--jarvis-text-xs);
    color: var(--vscode-terminal-ansiYellow);
  }
</style>
