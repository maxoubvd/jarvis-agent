import { executeTerminalCommand } from '../core/mcp/tools/terminal.js';

export type CheckpointType = 'action' | 'workflow' | 'session' | 'manual';

export interface Checkpoint {
  id: string;
  ref: string;
  type: CheckpointType;
  description: string;
  timestamp: string;
}

export interface RollbackResult {
  success: boolean;
  error?: string;
}

/**
 * "Time Travel" via git stash. Each checkpoint is a named stash entry so it can
 * be listed and re-applied without touching the commit history.
 */
export class CheckpointManager {
  private sessionId: string;

  constructor() {
    this.sessionId = `session-${Date.now()}`;
  }

  private sanitize(desc: string): string {
    return desc.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 50);
  }

  public async createCheckpoint(type: CheckpointType, description: string): Promise<Checkpoint | null> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `jarvis/checkpoint-${timestamp}-${type}-${this.sanitize(description)}`;

    // `git stash push` (even followed by an immediate `apply`) resets the
    // working tree to HEAD as its first step, which is a window where the
    // user's files are genuinely gone from disk until the re-apply succeeds.
    // `git add -A` + `git stash create` + `git stash store` records the exact
    // same snapshot (tracked + untracked changes) but only ever touches the
    // index, never the working tree — so there is no state in which a file
    // can go missing while a checkpoint is being created.
    await executeTerminalCommand('git add -A');
    const create = await executeTerminalCommand(`git stash create "${name}"`);
    await executeTerminalCommand('git reset'); // undo the staging above, working tree untouched

    if (!create.success) {
      throw new Error(create.stderr || 'Failed to create checkpoint');
    }

    const sha = create.stdout.trim();
    if (!sha) {
      return null; // Clean working tree — nothing to checkpoint.
    }

    const store = await executeTerminalCommand(`git stash store -m "${name}" ${sha}`);
    if (!store.success) {
      throw new Error(store.stderr || 'Failed to save checkpoint');
    }

    return {
      id: name,
      ref: 'stash@{0}',
      type,
      description,
      timestamp: new Date().toISOString()
    };
  }

  public async listCheckpoints(): Promise<Checkpoint[]> {
    const result = await executeTerminalCommand('git stash list');
    if (!result.success) {
      return [];
    }

    const checkpoints: Checkpoint[] = [];
    const lines = result.stdout.split('\n').filter(l => l.includes('jarvis/checkpoint-'));

    for (const line of lines) {
      // Format: stash@{0}: On main: jarvis/checkpoint-<ts>-<type>-<desc>
      const refMatch = line.match(/^(stash@\{\d+\})/);
      const nameMatch = line.match(/jarvis\/checkpoint-(\S+?)-(action|workflow|session|manual)-(.+)$/);
      if (!refMatch) continue;

      checkpoints.push({
        id: nameMatch ? `jarvis/checkpoint-${nameMatch[1]}-${nameMatch[2]}-${nameMatch[3]}` : refMatch[1],
        ref: refMatch[1],
        type: (nameMatch?.[2] as CheckpointType) ?? 'manual',
        description: nameMatch?.[3]?.replace(/-/g, ' ') ?? line,
        timestamp: nameMatch?.[1] ?? ''
      });
    }

    return checkpoints;
  }

  private parseUntrackedConflicts(stderr: string): string[] {
    return stderr
      .split('\n')
      .map(line => line.match(/^(.+) already exists, no checkout$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => m[1].trim());
  }

  /**
   * Runs `git stash apply [ref]`, retrying once if it's blocked by untracked
   * files that already exist on disk (see `rollback()` for why that happens).
   */
  private async applyStash(ref: string): Promise<RollbackResult> {
    const command = ref ? `git stash apply ${ref}` : 'git stash apply';
    let result = await executeTerminalCommand(command);

    if (!result.success && result.stderr.includes('could not restore untracked files from stash')) {
      const conflicts = this.parseUntrackedConflicts(result.stderr);
      for (const file of conflicts) {
        await executeTerminalCommand(`git clean -fd -- "${file}"`);
      }
      if (conflicts.length > 0) {
        result = await executeTerminalCommand(command);
      }
    }

    if (!result.success) {
      return { success: false, error: result.stderr || 'Rollback failed' };
    }

    // The stash's index reflects the `git add -A` done at checkpoint time,
    // so a bare apply leaves the restored files staged; unstage them so the
    // working tree looks like it did before the checkpoint, not pre-staged.
    await executeTerminalCommand('git reset');
    return { success: true };
  }

  public async rollback(ref: string): Promise<RollbackResult> {
    return this.applyStash(ref);
  }

  /**
   * Discards every change made since `ref`'s checkpoint and restores that
   * checkpoint's snapshot exactly. Unlike `rollback()`, which merges an old
   * stash onto whatever is currently on disk, this first resets the tree back
   * to HEAD so the stash re-applies cleanly instead of merging on top of the
   * newer edits it's supposed to undo.
   */
  private async hardResetAndApply(ref: string): Promise<RollbackResult> {
    await executeTerminalCommand('git checkout -- .');
    await executeTerminalCommand('git clean -fd');

    return this.rollback(ref);
  }

  /**
   * Discards every change made since the most recent checkpoint and restores
   * it exactly (used by the `/rollback` chat shortcut, one message = one
   * checkpoint).
   */
  public async rollbackToLastCheckpoint(): Promise<RollbackResult> {
    const checkpoints = await this.listCheckpoints();
    if (checkpoints.length === 0) {
      return { success: false, error: 'No checkpoint available' };
    }

    return this.hardResetAndApply(checkpoints[0].ref);
  }

  /**
   * Restores an arbitrary (not necessarily most-recent) checkpoint by its
   * stable `id`. `Checkpoint.ref` is positional (`stash@{N}`) and goes stale
   * the moment a newer checkpoint is created, so a `ref` captured earlier
   * must never be reused directly — this always re-resolves it via a fresh
   * `listCheckpoints()` call first.
   */
  public async restoreToCheckpoint(id: string): Promise<RollbackResult> {
    const { result } = await this.listAndRestore(id);
    return result;
  }

  /**
   * Same as `restoreToCheckpoint`, but also returns the checkpoint list it
   * already fetched to resolve the ref — `git stash apply` never mutates the
   * stash list, so a caller that also needs a fresh list right after (e.g. to
   * refresh the Checkpoints panel) can reuse this one instead of shelling out
   * to `git stash list` a second time.
   */
  public async listAndRestore(id: string): Promise<{ result: RollbackResult; checkpoints: Checkpoint[] }> {
    const checkpoints = await this.listCheckpoints();
    const target = checkpoints.find(c => c.id === id);
    if (!target) {
      return {
        result: { success: false, error: `Checkpoint not found (it may have been superseded): ${id}` },
        checkpoints
      };
    }

    const result = await this.hardResetAndApply(target.ref);
    return { result, checkpoints };
  }
}
