import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckpointManager } from '../../src/backend/services/checkpoint.js';

const { executeTerminalCommand } = vi.hoisted(() => ({
  executeTerminalCommand: vi.fn()
}));

vi.mock('../../src/backend/core/mcp/tools/terminal.js', () => ({
  executeTerminalCommand
}));

const ok = (stdout = '', stderr = '') => ({ success: true, stdout, stderr, exitCode: 0, timedOut: false });
const fail = (stderr = '', stdout = '') => ({ success: false, stdout, stderr, exitCode: 1, timedOut: false });

describe('CheckpointManager.rollback', () => {
  beforeEach(() => {
    executeTerminalCommand.mockReset();
  });

  it('succeeds directly when stash apply works first try', async () => {
    executeTerminalCommand
      .mockResolvedValueOnce(ok()) // git stash apply
      .mockResolvedValueOnce(ok()); // git reset (unstage)

    const manager = new CheckpointManager();
    const result = await manager.rollback('stash@{0}');

    expect(result.success).toBe(true);
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(1, 'git stash apply stash@{0}');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(2, 'git reset');
  });

  it('clears conflicting untracked files and retries when apply fails on them', async () => {
    const conflictStderr = [
      'Recette Jarvis/.jarvisignore already exists, no checkout',
      'Recette Jarvis/spec.md already exists, no checkout',
      'error: could not restore untracked files from stash'
    ].join('\n');

    executeTerminalCommand
      .mockResolvedValueOnce(fail(conflictStderr))
      .mockResolvedValueOnce(ok()) // git clean file 1
      .mockResolvedValueOnce(ok()) // git clean file 2
      .mockResolvedValueOnce(ok()) // retry apply
      .mockResolvedValueOnce(ok()); // git reset (unstage)

    const manager = new CheckpointManager();
    const result = await manager.rollback('stash@{0}');

    expect(result.success).toBe(true);
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(2, 'git clean -fd -- "Recette Jarvis/.jarvisignore"');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(3, 'git clean -fd -- "Recette Jarvis/spec.md"');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(4, 'git stash apply stash@{0}');
  });

  it('returns the original error when the failure is unrelated to untracked files', async () => {
    executeTerminalCommand.mockResolvedValueOnce(fail('error: no stash entries found'));

    const manager = new CheckpointManager();
    const result = await manager.rollback('stash@{0}');

    expect(result.success).toBe(false);
    expect(result.error).toBe('error: no stash entries found');
    expect(executeTerminalCommand).toHaveBeenCalledTimes(1);
  });
});

describe('CheckpointManager.createCheckpoint', () => {
  beforeEach(() => {
    executeTerminalCommand.mockReset();
  });

  it('never resets the working tree — only stages, snapshots, then unstages', async () => {
    executeTerminalCommand
      .mockResolvedValueOnce(ok()) // git add -A
      .mockResolvedValueOnce(ok('deadbeef')) // git stash create -> sha
      .mockResolvedValueOnce(ok()) // git reset (undo add -A)
      .mockResolvedValueOnce(ok()); // git stash store

    const manager = new CheckpointManager();
    const checkpoint = await manager.createCheckpoint('action', 'do stuff');

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.type).toBe('action');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(1, 'git add -A');
    expect(executeTerminalCommand.mock.calls[1][0]).toMatch(/^git stash create /);
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(3, 'git reset');
    expect(executeTerminalCommand.mock.calls[3][0]).toMatch(/^git stash store -m .* deadbeef$/);
    // Crucially: no `git stash push` / `git stash apply` in this path at all —
    // there is no step here that removes files from the working tree.
    for (const [command] of executeTerminalCommand.mock.calls) {
      expect(command).not.toMatch(/stash (push|apply)/);
    }
  });

  it('returns null when the working tree is clean (stash create has nothing to snapshot)', async () => {
    executeTerminalCommand
      .mockResolvedValueOnce(ok()) // git add -A
      .mockResolvedValueOnce(ok('')) // git stash create -> empty sha, nothing to stash
      .mockResolvedValueOnce(ok()); // git reset

    const manager = new CheckpointManager();
    const checkpoint = await manager.createCheckpoint('action', 'do stuff');

    expect(checkpoint).toBeNull();
    expect(executeTerminalCommand).toHaveBeenCalledTimes(3); // no `stash store` call
  });

  it('throws and still unstages when `git stash create` fails', async () => {
    executeTerminalCommand
      .mockResolvedValueOnce(ok()) // git add -A
      .mockResolvedValueOnce(fail('error: could not create stash')) // git stash create
      .mockResolvedValueOnce(ok()); // git reset

    const manager = new CheckpointManager();

    await expect(manager.createCheckpoint('action', 'do stuff')).rejects.toThrow('error: could not create stash');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(3, 'git reset');
  });

  it('throws when `git stash store` fails to record the snapshot', async () => {
    executeTerminalCommand
      .mockResolvedValueOnce(ok()) // git add -A
      .mockResolvedValueOnce(ok('deadbeef')) // git stash create
      .mockResolvedValueOnce(ok()) // git reset
      .mockResolvedValueOnce(fail('error: could not store stash')); // git stash store

    const manager = new CheckpointManager();

    await expect(manager.createCheckpoint('action', 'do stuff')).rejects.toThrow('error: could not store stash');
  });
});

describe('CheckpointManager.rollbackToLastCheckpoint', () => {
  beforeEach(() => {
    executeTerminalCommand.mockReset();
  });

  it('returns an error when there is no checkpoint to restore', async () => {
    executeTerminalCommand.mockResolvedValueOnce(ok()); // git stash list (empty)

    const manager = new CheckpointManager();
    const result = await manager.rollbackToLastCheckpoint();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Aucun checkpoint disponible');
    expect(executeTerminalCommand).toHaveBeenCalledTimes(1);
  });

  it('discards pending changes then applies the most recent checkpoint', async () => {
    const stashList = 'stash@{0}: On main: jarvis/checkpoint-2026-07-11T10-00-00-000Z-action-fix-bug';

    executeTerminalCommand
      .mockResolvedValueOnce(ok(stashList)) // git stash list
      .mockResolvedValueOnce(ok()) // git checkout -- .
      .mockResolvedValueOnce(ok()) // git clean -fd
      .mockResolvedValueOnce(ok()) // git stash apply
      .mockResolvedValueOnce(ok()); // git reset (unstage)

    const manager = new CheckpointManager();
    const result = await manager.rollbackToLastCheckpoint();

    expect(result.success).toBe(true);
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(2, 'git checkout -- .');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(3, 'git clean -fd');
    expect(executeTerminalCommand).toHaveBeenNthCalledWith(4, 'git stash apply stash@{0}');
  });
});
