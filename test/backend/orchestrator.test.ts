import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentOrchestrator, buildAgentSystemPrompt } from '../../src/backend/core/agent/orchestrator.js';
import { ToolRegistry, ToolDefinition } from '../../src/backend/core/agent/tool-registry.js';
import { ChatMessage, IModelProvider } from '../../src/backend/models/abstract.js';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test-workspace' } }]
  }
}));

function fakeProvider(responses: string[]): IModelProvider {
  let call = 0;
  return {
    name: 'fake',
    sendPrompt: async () => responses[Math.min(call++, responses.length - 1)],
    sendPromptStream: async (_m: ChatMessage[], onChunk, onDone) => {
      const response = responses[Math.min(call++, responses.length - 1)];
      onChunk(response);
      onDone();
    }
  };
}

function echoTool(): ToolDefinition {
  return {
    name: 'echo',
    description: 'returns the text',
    parameters: [{ name: 'text', type: 'string', description: 'text', required: true }],
    hitlAction: 'read_file',
    execute: async args => `ECHO: ${args.text}`
  };
}

describe('AgentOrchestrator', () => {
  it('executes a tool call then returns the final answer', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());

    const provider = fakeProvider([
      '{"thought": "I will use echo", "action": {"tool": "echo", "args": {"text": "hello"}}}',
      '{"thought": "done", "final": "The result is hello"}'
    ]);

    const orchestrator = new AgentOrchestrator(provider, registry);
    const events = { onToolCall: vi.fn(), onToolResult: vi.fn(), onFinal: vi.fn() };
    const result = await orchestrator.run('test', [], events);

    expect(result.success).toBe(true);
    expect(result.finalText).toBe('The result is hello');
    expect(result.iterations).toBe(2);
    expect(events.onToolCall).toHaveBeenCalledWith('echo', { text: 'hello' });
    expect(events.onToolResult).toHaveBeenCalledWith('echo', 'ECHO: hello', true, { text: 'hello' });
  });

  it('treats non-JSON responses as final answers', async () => {
    const registry = new ToolRegistry();
    const provider = fakeProvider(['Free text response without JSON.']);
    const orchestrator = new AgentOrchestrator(provider, registry);
    const result = await orchestrator.run('test');

    expect(result.success).toBe(true);
    expect(result.finalText).toBe('Free text response without JSON.');
  });

  it('reports unknown tools back to the model and continues', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "inexistant", "args": {}}}',
      '{"final": "ok"}'
    ]);
    const orchestrator = new AgentOrchestrator(provider, registry);
    const result = await orchestrator.run('test');

    expect(result.success).toBe(true);
    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].result).toContain('Unknown tool');
  });

  it('stops at maxIterations', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "loop"}}}'
    ]);
    const orchestrator = new AgentOrchestrator(provider, registry, { maxIterations: 3 });
    const result = await orchestrator.run('test');

    expect(result.success).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.finalText).toContain('iterations');
  });

  it('respects HITL refusal', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "x"}}}',
      '{"final": "abandoned"}'
    ]);
    const hitl = {
      checkApproval: vi.fn().mockResolvedValue({ granted: false, reason: 'Refused by user' })
    };
    const orchestrator = new AgentOrchestrator(provider, registry, { hitl });
    const result = await orchestrator.run('test');

    expect(hitl.checkApproval).toHaveBeenCalled();
    expect(result.steps[0].success).toBe(false);
    expect(result.finalText).toBe('abandoned');
  });

  it('tool policy "auto" bypasses the HITL gate', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "x"}}}',
      '{"final": "ok"}'
    ]);
    const hitl = {
      checkApproval: vi.fn().mockResolvedValue({ granted: false, reason: 'refused' }),
      askApproval: vi.fn().mockResolvedValue({ granted: false, reason: 'refused' })
    };
    const orchestrator = new AgentOrchestrator(provider, registry, {
      hitl,
      toolPolicies: { echo: 'auto' }
    });
    const result = await orchestrator.run('test');

    expect(hitl.checkApproval).not.toHaveBeenCalled();
    expect(hitl.askApproval).not.toHaveBeenCalled();
    expect(result.steps[0].success).toBe(true);
    expect(result.steps[0].result).toBe('ECHO: x');
  });

  it('tool policy "ask" forces the unconditional prompt', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "x"}}}',
      '{"final": "ok"}'
    ]);
    const hitl = {
      checkApproval: vi.fn().mockResolvedValue({ granted: true, reason: 'free mode' }),
      askApproval: vi.fn().mockResolvedValue({ granted: true, reason: 'approved' })
    };
    const orchestrator = new AgentOrchestrator(provider, registry, {
      hitl,
      toolPolicies: { echo: 'ask' }
    });
    const result = await orchestrator.run('test');

    expect(hitl.askApproval).toHaveBeenCalledWith('read_file', { text: 'x', _toolName: 'echo', _serverName: undefined });
    expect(hitl.checkApproval).not.toHaveBeenCalled();
    expect(result.steps[0].success).toBe(true);
  });

  it('buildAgentSystemPrompt applies model-profile options (compact + personaExtra)', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());

    const standard = buildAgentSystemPrompt(registry);
    expect(standard).not.toContain('EXEMPLE 2');

    const compact = buildAgentSystemPrompt(registry, undefined, undefined, {
      compact: true,
      personaExtra: 'You prioritize quality over speed.'
    });
    expect(compact).toContain('EXAMPLE 2');
    expect(compact).toContain('single_find_and_replace');
    expect(compact).toContain('You prioritize quality over speed.');
  });

  it('captures tool execution errors as step failures', async () => {
    const registry = new ToolRegistry();
    registry.register({
      ...echoTool(),
      execute: async () => {
        throw new Error('boom');
      }
    });
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "x"}}}',
      '{"final": "fin"}'
    ]);
    const orchestrator = new AgentOrchestrator(provider, registry);
    const result = await orchestrator.run('test');

    expect(result.steps[0].success).toBe(false);
    expect(result.steps[0].result).toContain('boom');
    expect(result.success).toBe(true);
  });

  it('invokes onFileEdited after a tracked file edit succeeds', async () => {
    const tmpFile = path.join(os.tmpdir(), `jarvis-orchestrator-test-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'before');
    try {
      const registry = new ToolRegistry();
      registry.register({
        name: 'edit_existing_file',
        description: 'edits a file',
        parameters: [],
        hitlAction: 'edit_existing_file',
        execute: async () => {
          fs.writeFileSync(tmpFile, 'after');
          return 'ok';
        }
      });
      const provider = fakeProvider([
        JSON.stringify({ action: { tool: 'edit_existing_file', args: { path: tmpFile } } }),
        JSON.stringify({ final: 'done' })
      ]);
      const changeTracker = { record: vi.fn() } as unknown as import('../../src/backend/services/change-tracker.js').ChangeTracker;
      const onFileEdited = vi.fn();
      const orchestrator = new AgentOrchestrator(provider, registry, { changeTracker, onFileEdited });
      await orchestrator.run('test');

      expect(changeTracker.record).toHaveBeenCalledWith(tmpFile, 'before', 'after');
      expect(onFileEdited).toHaveBeenCalledWith(tmpFile);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('does not call onFileEdited when there is no changeTracker', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      JSON.stringify({ action: { tool: 'echo', args: { text: 'x' } } }),
      JSON.stringify({ final: 'ok' })
    ]);
    const onFileEdited = vi.fn();
    const orchestrator = new AgentOrchestrator(provider, registry, { onFileEdited });
    await orchestrator.run('test');

    expect(onFileEdited).not.toHaveBeenCalled();
  });
});
