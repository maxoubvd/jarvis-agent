import { describe, it, expect, vi } from 'vitest';
import { sanitizeTodoItems } from '../../packages/core/src/core/agent/todo.js';
import { AgentOrchestrator } from '../../packages/core/src/core/agent/orchestrator.js';
import { ToolRegistry, createBuiltinTools } from '../../packages/core/src/core/agent/tool-registry.js';
import type { ChatMessage, IModelProvider } from '../../packages/core/src/models/abstract.js';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: [{ uri: { fsPath: '/test-workspace' } }] },
  window: { activeTextEditor: undefined }
}));

function fakeProvider(responses: string[]): IModelProvider {
  let call = 0;
  return {
    name: 'fake',
    sendPrompt: async () => responses[Math.min(call++, responses.length - 1)],
    sendPromptStream: async (_m: ChatMessage[], onChunk, onDone) => {
      onChunk(responses[Math.min(call++, responses.length - 1)]);
      onDone();
    }
  };
}

describe('sanitizeTodoItems', () => {
  it('keeps well-formed items and defaults missing status to pending', () => {
    const items = sanitizeTodoItems([
      { id: 'a', content: 'Write tests', status: 'in_progress' },
      { id: 'b', content: 'Ship it' }
    ]);
    expect(items).toEqual([
      { id: 'a', content: 'Write tests', status: 'in_progress' },
      { id: 'b', content: 'Ship it', status: 'pending' }
    ]);
  });

  it('drops entries without a non-empty content string', () => {
    expect(sanitizeTodoItems([{ id: 'a', content: '' }, { id: 'b' }, 'not-an-object', 42])).toEqual([]);
  });

  it('rejects unknown status values, falling back to pending', () => {
    expect(sanitizeTodoItems([{ content: 'x', status: 'bogus' }])).toEqual([
      { id: 'todo-0', content: 'x', status: 'pending' }
    ]);
  });

  it('returns an empty array for non-array input', () => {
    expect(sanitizeTodoItems(undefined)).toEqual([]);
    expect(sanitizeTodoItems('nope')).toEqual([]);
  });
});

describe('update_todo_list tool', () => {
  it('is registered among the builtin tools with an auto-friendly hitlAction', () => {
    const tool = createBuiltinTools().find(t => t.name === 'update_todo_list');
    expect(tool).toBeDefined();
    expect(tool!.hitlAction).toBe('update_todo_list');
  });

  it('reports the item count without throwing on malformed input', async () => {
    const tool = createBuiltinTools().find(t => t.name === 'update_todo_list')!;
    const result = await tool.execute({ items: [{ content: 'a' }, { content: '' }] });
    expect(result).toContain('1 task');
  });
});

describe('AgentOrchestrator + update_todo_list', () => {
  it('fires onTodoUpdate with sanitized items after a successful call', async () => {
    const registry = new ToolRegistry();
    registry.register(createBuiltinTools().find(t => t.name === 'update_todo_list')!);

    const provider = fakeProvider([
      JSON.stringify({
        action: { tool: 'update_todo_list', args: { items: [{ id: '1', content: 'Step one', status: 'in_progress' }] } }
      }),
      JSON.stringify({ final: 'ok' })
    ]);

    const onTodoUpdate = vi.fn();
    const orchestrator = new AgentOrchestrator(provider, registry, { toolPolicies: { update_todo_list: 'auto' } });
    await orchestrator.run('test', [], { onTodoUpdate });

    expect(onTodoUpdate).toHaveBeenCalledWith([{ id: '1', content: 'Step one', status: 'in_progress' }]);
  });
});
