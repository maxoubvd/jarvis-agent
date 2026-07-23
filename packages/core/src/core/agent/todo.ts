/** Item in the visual TODO list (tool `update_todo_list`, Claude Code `TodoWrite`-style). */
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed']);

/** Validates/sanitizes a raw list (from the model or a workflow run) into TodoItem[]. */
export function sanitizeTodoItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const items: TodoItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as Record<string, unknown>).id;
    const content = (entry as Record<string, unknown>).content;
    const status = (entry as Record<string, unknown>).status;
    if (typeof content !== 'string' || !content.trim()) continue;
    items.push({
      id: typeof id === 'string' && id ? id : `todo-${items.length}`,
      content: content.trim(),
      status: typeof status === 'string' && VALID_STATUSES.has(status) ? (status as TodoItem['status']) : 'pending'
    });
  }
  return items;
}
