import { describe, it, expect } from 'vitest';
import { BackgroundProcessManager } from '../../src/backend/services/background-processes.js';

async function waitFor(condition: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

describe('BackgroundProcessManager', () => {
  it('runs a command detached and captures output + exit code', async () => {
    const mgr = new BackgroundProcessManager();
    // Sans guillemets imbriqués : cmd.exe /c les mangle.
    const started = mgr.start('node -p 40+2', process.cwd());
    expect(started.id).toBe('bg-1');

    await waitFor(() => mgr.status(started.id)?.running === false);
    const status = mgr.status(started.id)!;
    expect(status.output).toContain('42');
    expect(status.exitCode).toBe(0);
  });

  it('stop() kills a long-running process', async () => {
    const mgr = new BackgroundProcessManager();
    const started = mgr.start('node -e setTimeout(Function,30000)', process.cwd());
    expect(mgr.status(started.id)?.running).toBe(true);

    expect(mgr.stop(started.id)).toBe(true);
    expect(mgr.status(started.id)?.running).toBe(false);
    // Un second stop est un no-op.
    expect(mgr.stop(started.id)).toBe(false);
    mgr.dispose();
  });

  it('status() returns null for unknown ids and list() shows everything', async () => {
    const mgr = new BackgroundProcessManager();
    expect(mgr.status('bg-999')).toBeNull();
    const started = mgr.start('node -p 1', process.cwd());
    expect(mgr.list().map(p => p.id)).toContain(started.id);
    await waitFor(() => mgr.status(started.id)?.running === false);
    mgr.dispose();
  });
});
