import { describe, it, expect, vi } from 'vitest';
import { AutoTDDLoop, summarizeTestOutput, TestRunResult } from '../../src/backend/services/tdd-loop.js';
import { ChatMessage, IModelProvider } from '../../src/backend/models/abstract.js';

function fakeProvider(responses: string[]): IModelProvider {
  let call = 0;
  return {
    name: 'fake',
    sendPrompt: async () => responses[Math.min(call++, responses.length - 1)],
    sendPromptStream: async (_m: ChatMessage[], _c, onDone) => onDone()
  };
}

const generation = (content: string) =>
  JSON.stringify({ explanation: 'test', files: [{ path: 'src/sum.ts', content }] });

describe('AutoTDDLoop (spec §3.3)', () => {
  it('succeeds on first attempt when tests pass', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const runCommand = vi.fn().mockResolvedValue({
      success: true, stdout: 'ok', stderr: '', timedOut: false
    } satisfies TestRunResult);

    const loop = new AutoTDDLoop(fakeProvider([generation('export const sum = (a,b)=>a+b;')]), {
      writeFile,
      runCommand
    });
    const result = await loop.run('implémente sum');

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.filesWritten).toEqual(['src/sum.ts']);
    expect(writeFile).toHaveBeenCalledOnce();
  });

  it('retries after failure and succeeds on second attempt', async () => {
    const results: TestRunResult[] = [
      { success: false, stdout: '', stderr: 'Expected 3, got 2', timedOut: false },
      { success: true, stdout: 'ok', stderr: '', timedOut: false }
    ];
    let run = 0;
    const loop = new AutoTDDLoop(
      fakeProvider([generation('v1'), generation('v2')]),
      { writeFile: vi.fn().mockResolvedValue(undefined), runCommand: async () => results[run++] }
    );

    const attempts: number[] = [];
    const result = await loop.run('fix sum', {}, { onAttemptStart: a => attempts.push(a) });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(attempts).toEqual([1, 2]);
  });

  it('stops after maxAttempts failures', async () => {
    const loop = new AutoTDDLoop(fakeProvider([generation('broken')]), {
      writeFile: vi.fn().mockResolvedValue(undefined),
      runCommand: async () => ({ success: false, stdout: '', stderr: 'fail', timedOut: false })
    });
    const result = await loop.run('tâche impossible', { maxAttempts: 3 });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.error).toContain('3 tentatives');
  });

  it('asks for valid JSON again when generation is unparseable', async () => {
    const loop = new AutoTDDLoop(
      fakeProvider(['pas du json', generation('ok')]),
      {
        writeFile: vi.fn().mockResolvedValue(undefined),
        runCommand: async () => ({ success: true, stdout: '', stderr: '', timedOut: false })
      }
    );
    const result = await loop.run('tâche', { maxAttempts: 3 });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it('doubles the timeout after a timed-out run', async () => {
    const timeouts: number[] = [];
    const loop = new AutoTDDLoop(fakeProvider([generation('slow')]), {
      writeFile: vi.fn().mockResolvedValue(undefined),
      runCommand: async (_c, timeout) => {
        timeouts.push(timeout);
        return { success: false, stdout: '', stderr: '', timedOut: true };
      }
    });
    await loop.run('tâche lente', { maxAttempts: 3, timeout: 1000 });

    expect(timeouts).toEqual([1000, 2000, 4000]);
  });
});

describe('summarizeTestOutput', () => {
  it('keeps the tail of long outputs', () => {
    const long = 'x'.repeat(5000) + 'ERREUR FINALE';
    const summary = summarizeTestOutput(long, '', 100);
    expect(summary).toContain('ERREUR FINALE');
    expect(summary).toContain('tronqué');
  });
});
