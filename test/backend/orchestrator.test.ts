import { describe, it, expect, vi } from 'vitest';
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
    description: 'renvoie le texte',
    parameters: [{ name: 'text', type: 'string', description: 'texte', required: true }],
    hitlAction: 'read_file',
    execute: async args => `ECHO: ${args.text}`
  };
}

describe('AgentOrchestrator', () => {
  it('executes a tool call then returns the final answer', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());

    const provider = fakeProvider([
      '{"thought": "j\'utilise echo", "action": {"tool": "echo", "args": {"text": "bonjour"}}}',
      '{"thought": "fini", "final": "Le résultat est bonjour"}'
    ]);

    const orchestrator = new AgentOrchestrator(provider, registry);
    const events = { onToolCall: vi.fn(), onToolResult: vi.fn(), onFinal: vi.fn() };
    const result = await orchestrator.run('test', [], events);

    expect(result.success).toBe(true);
    expect(result.finalText).toBe('Le résultat est bonjour');
    expect(result.iterations).toBe(2);
    expect(events.onToolCall).toHaveBeenCalledWith('echo', { text: 'bonjour' });
    expect(events.onToolResult).toHaveBeenCalledWith('echo', 'ECHO: bonjour', true, { text: 'bonjour' });
  });

  it('treats non-JSON responses as final answers', async () => {
    const registry = new ToolRegistry();
    const provider = fakeProvider(['Réponse en texte libre sans JSON.']);
    const orchestrator = new AgentOrchestrator(provider, registry);
    const result = await orchestrator.run('test');

    expect(result.success).toBe(true);
    expect(result.finalText).toBe('Réponse en texte libre sans JSON.');
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
    expect(result.steps[0].result).toContain('Outil inconnu');
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
    expect(result.finalText).toContain('itérations');
  });

  it('respects HITL refusal', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "x"}}}',
      '{"final": "abandonné"}'
    ]);
    const hitl = {
      checkApproval: vi.fn().mockResolvedValue({ granted: false, reason: 'Refusé par l\'utilisateur' })
    };
    const orchestrator = new AgentOrchestrator(provider, registry, { hitl });
    const result = await orchestrator.run('test');

    expect(hitl.checkApproval).toHaveBeenCalled();
    expect(result.steps[0].success).toBe(false);
    expect(result.finalText).toBe('abandonné');
  });

  it('tool policy "auto" bypasses the HITL gate', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const provider = fakeProvider([
      '{"action": {"tool": "echo", "args": {"text": "x"}}}',
      '{"final": "ok"}'
    ]);
    const hitl = {
      checkApproval: vi.fn().mockResolvedValue({ granted: false, reason: 'refusé' }),
      askApproval: vi.fn().mockResolvedValue({ granted: false, reason: 'refusé' })
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
      checkApproval: vi.fn().mockResolvedValue({ granted: true, reason: 'mode libre' }),
      askApproval: vi.fn().mockResolvedValue({ granted: true, reason: 'approuvé' })
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
      personaExtra: 'Tu privilégies la qualité à la vitesse.'
    });
    expect(compact).toContain('EXEMPLE 2');
    expect(compact).toContain('single_find_and_replace');
    expect(compact).toContain('Tu privilégies la qualité à la vitesse.');
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
});
