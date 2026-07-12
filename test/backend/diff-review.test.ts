import { describe, it, expect, vi } from 'vitest';

// ChangeTracker imports `vscode` only for its EventEmitter (review notification).
vi.mock('vscode', () => ({
  EventEmitter: class {
    fire() { /* no-op in test */ }
    event() { /* no-op in test */ }
  }
}));

import { computeHunks, resolveHunk } from '../../src/backend/services/diff.js';
import { ChangeTracker } from '../../src/backend/services/change-tracker.js';

const BEFORE = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');
// Two hunks: line2 modified, and an insertion after line4.
const AFTER = ['line1', 'line2-modified', 'line3', 'line4', 'inserted', 'line5'].join('\n');

describe('diff — computeHunks', () => {
  it('groups changes into separate hunks with positions and context', () => {
    const hunks = computeHunks(BEFORE, AFTER);
    expect(hunks).toHaveLength(2);

    expect(hunks[0]).toMatchObject({
      id: 0,
      beforeStart: 2,
      beforeLines: ['line2'],
      afterLines: ['line2-modified']
    });
    expect(hunks[0].contextBefore).toEqual(['line1']);

    expect(hunks[1]).toMatchObject({
      id: 1,
      beforeLines: [],
      afterLines: ['inserted']
    });
  });

  it('returns no hunks for identical content', () => {
    expect(computeHunks(BEFORE, BEFORE)).toHaveLength(0);
  });
});

describe('diff — resolveHunk', () => {
  it('accept merges the hunk into the baseline, file untouched', () => {
    const { before, after } = resolveHunk(BEFORE, AFTER, 0, 'accept');
    expect(after).toBe(AFTER);
    // The baseline incorporates line2-modified; only the "inserted" hunk remains in the diff.
    const remaining = computeHunks(before, after);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].afterLines).toEqual(['inserted']);
  });

  it('reject removes the hunk from the file, baseline untouched', () => {
    const { before, after } = resolveHunk(BEFORE, AFTER, 1, 'reject');
    expect(before).toBe(BEFORE);
    expect(after).toBe(['line1', 'line2-modified', 'line3', 'line4', 'line5'].join('\n'));
    const remaining = computeHunks(before, after);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].beforeLines).toEqual(['line2']);
  });
});

describe('ChangeTracker', () => {
  it('records writes, merges successive edits, and clears on no-op', () => {
    const tracker = new ChangeTracker();
    tracker.record('a.ts', BEFORE, AFTER);
    tracker.record('a.ts', AFTER, BEFORE); // back to the initial content
    expect(tracker.pendingCount).toBe(0);
  });

  it('accepting every hunk completes the file review without disk actions', () => {
    const tracker = new ChangeTracker();
    tracker.record('a.ts', BEFORE, AFTER);

    let view = tracker.snapshot()[0];
    expect(view.hunks).toHaveLength(2);

    expect(tracker.resolveHunk('a.ts', 0, view.revision, 'accept')).toBeNull();
    view = tracker.snapshot()[0];
    expect(view.hunks).toHaveLength(1);

    expect(tracker.resolveHunk('a.ts', view.hunks[0].id, view.revision, 'accept')).toBeNull();
    expect(tracker.pendingCount).toBe(0);
  });

  it('rejecting a hunk returns the content to write back', () => {
    const tracker = new ChangeTracker();
    tracker.record('a.ts', BEFORE, AFTER);
    const view = tracker.snapshot()[0];

    const action = tracker.resolveHunk('a.ts', 1, view.revision, 'reject');
    expect(action?.content).toBe(['line1', 'line2-modified', 'line3', 'line4', 'line5'].join('\n'));
    expect(tracker.pendingCount).toBe(1); // the line2 hunk remains to review
  });

  it('ignores stale revisions (double-click safety)', () => {
    const tracker = new ChangeTracker();
    tracker.record('a.ts', BEFORE, AFTER);
    const view = tracker.snapshot()[0];
    tracker.resolveHunk('a.ts', 0, view.revision, 'accept');
    // Second click with the stale revision: ignored.
    expect(tracker.resolveHunk('a.ts', 1, view.revision, 'reject')).toBeNull();
  });

  it('rejecting a new file asks for its deletion', () => {
    const tracker = new ChangeTracker();
    tracker.record('new.ts', null, 'contenu');
    expect(tracker.snapshot()[0].isNew).toBe(true);

    const action = tracker.resolveFile('new.ts', 'reject');
    expect(action).toEqual({ path: 'new.ts', content: null });
  });

  it('resolveAll(reject) restores every file, resolveAll(accept) clears silently', () => {
    const tracker = new ChangeTracker();
    tracker.record('a.ts', BEFORE, AFTER);
    tracker.record('new.ts', null, 'contenu');

    const actions = tracker.resolveAll('reject');
    expect(actions).toEqual([
      { path: 'a.ts', content: BEFORE },
      { path: 'new.ts', content: null }
    ]);
    expect(tracker.pendingCount).toBe(0);

    tracker.record('a.ts', BEFORE, AFTER);
    expect(tracker.resolveAll('accept')).toEqual([]);
    expect(tracker.pendingCount).toBe(0);
  });

  it('runUntracked suppresses recording of our own revert writes', async () => {
    const tracker = new ChangeTracker();
    await tracker.runUntracked(async () => {
      tracker.record('a.ts', BEFORE, AFTER);
    });
    expect(tracker.pendingCount).toBe(0);
  });
});
