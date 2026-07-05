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

    // `git stash push --include-untracked` keeps the working tree changes
    // stashed but also restores them (via `stash apply` below on rollback).
    const result = await executeTerminalCommand(
      `git stash push --include-untracked -m "${name}"`
    );

    if (!result.success) {
      // "No local changes to save" is not a fatal error — nothing to checkpoint.
      if (result.stdout.includes('No local changes') || result.stderr.includes('No local changes')) {
        return null;
      }
      throw new Error(result.stderr || 'Échec de création du checkpoint');
    }

    // Re-apply so the user keeps working on their changes after the snapshot.
    await executeTerminalCommand('git stash apply');

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

  public async rollback(ref: string): Promise<RollbackResult> {
    const result = await executeTerminalCommand(`git stash apply ${ref}`);
    if (!result.success) {
      return { success: false, error: result.stderr || 'Échec du rollback' };
    }
    return { success: true };
  }
}
