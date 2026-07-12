import { describe, it, expect } from 'vitest';
import { TokenCounter, estimateTokens } from '../../src/backend/services/token-counter.js';
import { ResponseCache } from '../../src/backend/services/response-cache.js';
import { detectAgentMention, suggestAgent, SPECIALIZED_AGENTS } from '../../src/backend/services/agents.js';
import { getWorkflow, WORKFLOWS, WorkflowRunner } from '../../src/backend/services/workflows.js';
import { OperationLogger } from '../../src/backend/services/logger.js';

describe('TokenCounter (spec §3.2)', () => {
  it('tracks input/output separately with history', () => {
    const counter = new TokenCounter(1000);
    counter.addRequest('m1', 100, 50);
    counter.addRequest('m2', 200, 100);

    const usage = counter.getUsage();
    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(150);
    expect(usage.used).toBe(450);
    expect(usage.percentage).toBe(45);
    expect(usage.level).toBe('green');
    expect(usage.history).toHaveLength(2);
    expect(usage.history[0].model).toBe('m2');
  });

  it('keeps only the last 5 requests in history', () => {
    const counter = new TokenCounter();
    for (let i = 0; i < 8; i++) counter.addRequest(`m${i}`, 1, 1);
    expect(counter.getUsage().history).toHaveLength(5);
    expect(counter.getUsage().history[0].model).toBe('m7');
  });

  it('reports orange at 50-80% and red above 80%', () => {
    const counter = new TokenCounter(100);
    counter.addRequest('m', 30, 30);
    expect(counter.getUsage().level).toBe('orange');
    counter.addRequest('m', 15, 10);
    expect(counter.getUsage().level).toBe('red');
    expect(counter.isNearLimit()).toBe(true);
  });

  it('estimates tokens roughly at 4 chars per token', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('reports a null limit and 0% when no model is configured', () => {
    const counter = new TokenCounter();
    counter.addRequest('m', 100, 50);
    const usage = counter.getUsage();
    expect(usage.limit).toBeNull();
    expect(usage.percentage).toBe(0);
    expect(usage.level).toBe('green');
    expect(counter.isNearLimit()).toBe(false);
  });

  it('clears the limit when set back to null (model removed)', () => {
    const counter = new TokenCounter(1000);
    counter.setLimit(null);
    expect(counter.getUsage().limit).toBeNull();
    counter.setLimit(2048);
    expect(counter.getUsage().limit).toBe(2048);
  });
});

describe('ResponseCache (spec §3.2)', () => {
  it('returns cached responses for identical requests', () => {
    const cache = new ResponseCache();
    const key = ResponseCache.keyFor('m', [{ role: 'user', content: 'hello' }]);
    expect(cache.get(key)).toBeUndefined();
    cache.set(key, 'response');
    expect(cache.get(key)).toBe('response');
  });

  it('produces different keys for different messages or models', () => {
    const k1 = ResponseCache.keyFor('m', [{ role: 'user', content: 'a' }]);
    const k2 = ResponseCache.keyFor('m', [{ role: 'user', content: 'b' }]);
    const k3 = ResponseCache.keyFor('n', [{ role: 'user', content: 'a' }]);
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it('evicts oldest entries beyond maxEntries', () => {
    const cache = new ResponseCache(2);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });
});

describe('Specialized agents (spec §5.1)', () => {
  it('defines the 5 predefined agents', () => {
    expect(SPECIALIZED_AGENTS.map(a => a.mention)).toEqual([
      '@QA-Agent', '@Doc-Agent', '@Refactor-Agent', '@Security-Agent', '@Perf-Agent'
    ]);
  });

  it('detects a mention and extracts the task', () => {
    const mention = detectAgentMention('@QA-Agent check the utils.ts file');
    expect(mention?.agent.id).toBe('qa');
    expect(mention?.task).toBe('check the utils.ts file');
  });

  it('is case-insensitive', () => {
    expect(detectAgentMention('@qa-agent test')?.agent.id).toBe('qa');
  });

  it('returns null without mention', () => {
    expect(detectAgentMention('hello')).toBeNull();
  });

  it('suggests an agent from keywords', () => {
    expect(suggestAgent('there is a bug in the tests')?.id).toBe('qa');
    expect(suggestAgent('security audit of secrets')?.id).toBe('security');
    expect(suggestAgent('hello')).toBeNull();
  });

  it('restricts each predefined agent to a coherent, non-empty tool subset', () => {
    for (const agent of SPECIALIZED_AGENTS) {
      expect(agent.allowedToolPrefixes?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('never grants edit tools to QA-Agent or Security-Agent (read-only audit agents)', () => {
    const editTools = ['create_new_file', 'edit_existing_file', 'single_find_and_replace'];
    for (const id of ['qa', 'security']) {
      const agent = SPECIALIZED_AGENTS.find(a => a.id === id)!;
      for (const editTool of editTools) {
        expect(agent.allowedToolPrefixes).not.toContain(editTool);
      }
    }
  });

  it('never grants terminal tools to Security-Agent (audit stays passive)', () => {
    const agent = SPECIALIZED_AGENTS.find(a => a.id === 'security')!;
    expect(agent.allowedToolPrefixes).not.toContain('run_terminal_command');
  });

  it('grants edit tools to Doc-Agent and Refactor-Agent', () => {
    for (const id of ['doc', 'refactor']) {
      const agent = SPECIALIZED_AGENTS.find(a => a.id === id)!;
      expect(agent.allowedToolPrefixes).toContain('edit_existing_file');
    }
  });
});

describe('Workflows (spec §5.2)', () => {
  it('defines the predefined workflows (5 fixes + AI-driven dynamic decomposition)', () => {
    expect(WORKFLOWS.map(w => w.id)).toEqual([
      'dynamic', 'dev-feature', 'bug-fix', 'code-review', 'refactor', 'setup-project'
    ]);
    expect(getWorkflow('bug-fix')?.steps).toHaveLength(4);
  });

  it('runs steps sequentially, passing the previous summary', async () => {
    const prompts: string[] = [];
    const orchestrator = {
      run: async (prompt: string) => {
        prompts.push(prompt);
        return { success: true, finalText: `result-${prompts.length}`, steps: [], iterations: 1 };
      }
    };
    const runner = new WorkflowRunner(orchestrator as never);
    const result = await runner.run('bug-fix', 'crash on startup');

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(4);
    expect(prompts[0]).toContain('crash on startup');
    expect(prompts[1]).toContain('result-1');
  });

  it('stops at the first failed step', async () => {
    let calls = 0;
    const orchestrator = {
      run: async () => {
        calls++;
        return calls === 2
          ? { success: false, finalText: '', steps: [], iterations: 1, error: 'panne' }
          : { success: true, finalText: 'ok', steps: [], iterations: 1 };
      }
    };
    const runner = new WorkflowRunner(orchestrator as never);
    const result = await runner.run('refactor', 'nettoyer');

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
    expect(result.error).toContain('panne');
  });

  it('rejects unknown workflow ids', async () => {
    const runner = new WorkflowRunner({ run: async () => ({}) } as never);
    const result = await runner.run('inconnu', 'x');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown workflow');
  });

  it('creates a checkpoint before running', async () => {
    let checkpointed = false;
    const orchestrator = {
      run: async () => ({ success: true, finalText: 'ok', steps: [], iterations: 1 })
    };
    const runner = new WorkflowRunner(orchestrator as never, async () => {
      checkpointed = true;
    });
    await runner.run('dev-feature', 'feature x');
    expect(checkpointed).toBe(true);
  });
});

describe('OperationLogger (spec §6)', () => {
  it('notifies listeners and keeps entries', () => {
    const logger = new OperationLogger();
    const seen: string[] = [];
    logger.onEntry(e => seen.push(`${e.operation}:${e.status}`));
    logger.log('terminal', 'npm test', 'success');
    logger.log('write_file', 'a.ts', 'blocked');

    expect(seen).toEqual(['terminal:success', 'write_file:blocked']);
    expect(logger.getEntries()).toHaveLength(2);
  });

  it('supports unsubscribe', () => {
    const logger = new OperationLogger();
    const seen: string[] = [];
    const off = logger.onEntry(e => seen.push(e.operation));
    logger.log('a', '');
    off();
    logger.log('b', '');
    expect(seen).toEqual(['a']);
  });
});
