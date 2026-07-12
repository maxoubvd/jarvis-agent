<script lang="ts">
  interface Props {
    checked?: boolean;
    disabled?: boolean;
    /** Label displayed to the right of the switch (optional). */
    label?: string;
    title?: string;
    onchange?: (checked: boolean) => void;
  }

  let { checked = false, disabled = false, label = '', title = '', onchange = () => {} }: Props = $props();
</script>

<label class="toggle" class:disabled title={title || undefined}>
  <input
    type="checkbox"
    role="switch"
    {checked}
    {disabled}
    onchange={e => {
      const target = e.target as HTMLInputElement;
      onchange(target.checked);
      // The browser has already toggled the checkbox visually before this
      // handler runs. If the parent refuses the change (`onchange` doesn't
      // update `checked`, e.g. a toggle intercepted by a confirmation),
      // Svelte only reapplies `checked` to the DOM if its VALUE changes —
      // so nothing else fixes the checkbox. We resync it explicitly here,
      // after the synchronous call to `onchange` (which already had a
      // chance to update the state).
      target.checked = checked;
    }}
  />
  <span class="track" aria-hidden="true"><span class="thumb"></span></span>
  {#if label}<span class="text">{label}</span>{/if}
</label>

<style>
  .toggle {
    /* position:relative anchors the hidden checkbox (position:absolute) INSIDE
       the switch. Without this, the input anchors to the top of the scrollable
       container and clicking to focus makes the view "jump" to the top. */
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: var(--jarvis-space-1);
    cursor: pointer;
    font-size: var(--jarvis-text-sm);
    white-space: nowrap;
    user-select: none;
  }

  .toggle.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* Real checkbox, visually hidden but still focusable (a11y). */
  input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
    opacity: 0;
    pointer-events: none;
  }

  .track {
    flex-shrink: 0;
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: var(--jarvis-radius-pill);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
    transition: background var(--jarvis-transition), border-color var(--jarvis-transition);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: var(--jarvis-radius-pill);
    background: var(--vscode-descriptionForeground);
    transition: transform var(--jarvis-transition), background var(--jarvis-transition);
  }

  input:checked + .track {
    background: var(--jarvis-accent);
    border-color: transparent;
  }

  input:checked + .track .thumb {
    transform: translateX(12px);
    background: var(--jarvis-accent-fg);
  }

  input:focus-visible + .track {
    outline: 1px solid var(--jarvis-accent);
    outline-offset: 1px;
  }

  .text {
    color: inherit;
  }
</style>
