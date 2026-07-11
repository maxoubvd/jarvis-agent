<script lang="ts">
  import type { TodoItem } from '../shared/types';
  import Icon from './Icon.svelte';

  interface Props {
    items?: TodoItem[];
  }

  let { items = [] }: Props = $props();

  let collapsed = $state(false);
  let doneCount = $derived(items.filter(i => i.status === 'completed').length);
</script>

{#if items.length > 0}
  <div class="todo-list">
    <button class="todo-header" onclick={() => (collapsed = !collapsed)}>
      <Icon name={collapsed ? 'chevron-down' : 'chevron-up'} size={12} />
      <span>Tasks ({doneCount}/{items.length})</span>
    </button>
    {#if !collapsed}
      <ul>
        {#each items as item (item.id)}
          <li class="todo-item {item.status}">
            {#if item.status === 'completed'}
              <Icon name="check" size={12} />
            {:else if item.status === 'in_progress'}
              <Icon name="sync" size={12} />
            {:else}
              <Icon name="square" size={12} />
            {/if}
            <span>{item.content}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .todo-list {
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 0.35rem;
    background: var(--vscode-editorWidget-background);
    font-size: var(--jarvis-text-xs, 0.78rem);
    margin: 0 0 0.4rem;
  }

  .todo-header {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.3rem 0.55rem;
    background: transparent;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: inherit;
    text-align: left;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0 0.55rem 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .todo-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--vscode-foreground);
  }

  .todo-item.completed {
    color: var(--vscode-descriptionForeground);
    text-decoration: line-through;
  }

  .todo-item.in_progress {
    color: var(--jarvis-accent, var(--vscode-textLink-foreground));
    font-weight: 500;
  }
</style>
