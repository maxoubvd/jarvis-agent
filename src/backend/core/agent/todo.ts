/** Item de la TODO list visuelle (outil `update_todo_list`, façon Claude Code `TodoWrite`). */
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed']);

/** Valide/nettoie une liste brute (venant du modèle ou d'un run de workflow) en TodoItem[]. */
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
