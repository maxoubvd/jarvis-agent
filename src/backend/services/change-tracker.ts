import * as vscode from 'vscode';
import { computeHunks, resolveHunk, type DiffHunk } from './diff.js';

/** View of a file pending review, sent to the webview. */
export interface PendingFileView {
  path: string;
  /** true = file created by the AI (rejecting the file = deletion). */
  isNew: boolean;
  /** Incremented on every update — stale resolutions are ignored. */
  revision: number;
  hunks: DiffHunk[];
}

interface PendingFile {
  path: string;
  /** Baseline (accepted) content. `null` = the file didn't exist. */
  before: string | null;
  /** Current content on disk. */
  after: string;
  revision: number;
}

/** Disk action the caller must perform after a resolution. */
export interface DiskAction {
  path: string;
  /** `null` = delete the file (rejecting a creation). */
  content: string | null;
}

/**
 * Tracks AI changes for diff review (Antigravity-style): writes are applied
 * immediately and then reviewed — accepting a hunk merges it into the
 * baseline, rejecting it rewrites the file without it.
 * The class is pure (no I/O): the disk writes it requires are returned to
 * the caller as {@link DiskAction}.
 */
export class ChangeTracker {
  private files = new Map<string, PendingFile>();
  /** true while applying a resolution: our own writes are not re-tracked. */
  private applying = false;

  public readonly onDidChange = new vscode.EventEmitter<void>();

  /** Records an AI write (called by the fileSystem listener). */
  public record(path: string, before: string | null, after: string): void {
    if (this.applying) return;
    const existing = this.files.get(path);
    if (existing) {
      existing.after = after;
      existing.revision++;
      // Back to the baseline content → nothing left to review.
      if (existing.before !== null && existing.before === after) this.files.delete(path);
      return;
    }
    if (before !== null && before === after) return;
    this.files.set(path, { path, before, after, revision: 1 });
    this.onDidChange.fire();
  }

  /** Runs `fn` without tracking the writes it triggers. */
  public async runUntracked<T>(fn: () => Promise<T>): Promise<T> {
    this.applying = true;
    try {
      return await fn();
    } finally {
      this.applying = false;
    }
  }

  public get pendingCount(): number {
    return this.files.size;
  }

  /** Current baseline content of a file under review (`''` if created by the AI), `null` if untracked. */
  public getBaseline(path: string): string | null {
    const file = this.files.get(path);
    if (!file) return null;
    return file.before ?? '';
  }

  /** true if the file is pending review. */
  public isPending(path: string): boolean {
    return this.files.has(path);
  }

  public snapshot(): PendingFileView[] {
    return [...this.files.values()].map(f => ({
      path: f.path,
      isNew: f.before === null,
      revision: f.revision,
      hunks: computeHunks(f.before ?? '', f.after)
    }));
  }

  /**
   * Resolves a hunk. Returns the disk action to apply (rejection) or `null`
   * (acceptance, or a stale/unknown resolution — nothing to do).
   */
  public resolveHunk(
    path: string,
    hunkId: number,
    revision: number,
    action: 'accept' | 'reject'
  ): DiskAction | null {
    const file = this.files.get(path);
    if (!file || file.revision !== revision) return null;

    const resolved = resolveHunk(file.before ?? '', file.after, hunkId, action);
    file.before = resolved.before;
    file.after = resolved.after;
    file.revision++;
    if (file.before === file.after) this.files.delete(path);

    this.onDidChange.fire();

    return action === 'reject' ? { path, content: resolved.after } : null;
  }

  /** Resolves an entire file. Rejecting a creation = deleting the file. */
  public resolveFile(path: string, action: 'accept' | 'reject'): DiskAction | null {
    const file = this.files.get(path);
    if (!file) return null;
    this.files.delete(path);
    this.onDidChange.fire();
    if (action === 'accept') return null;
    return { path, content: file.before };
  }

  /** Resolves everything. Returns the disk actions for the rejections. */
  public resolveAll(action: 'accept' | 'reject'): DiskAction[] {
    const actions: DiskAction[] = [];
    for (const path of [...this.files.keys()]) {
      const diskAction = this.resolveFile(path, action);
      if (diskAction) actions.push(diskAction);
    }
    return actions;
  }
}
