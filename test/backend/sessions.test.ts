import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SessionStore, MAX_SESSIONS } from '../../packages/core/src/services/sessions.js';
import type { ChatMessage } from '../../packages/core/src/models/abstract.js';

let tmpDir: string;
let filePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sessions-'));
  filePath = path.join(tmpDir, 'jarvis-sessions.json');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SessionStore.forkCurrent', () => {
  it('syncs the full current conversation and seeds a new current one in a single call', () => {
    const store = new SessionStore(filePath);
    const original: ChatMessage[] = [
      { role: 'user', content: 'first message' },
      { role: 'assistant', content: 'first reply' },
      { role: 'user', content: 'second message' },
      { role: 'assistant', content: 'second reply' }
    ];
    const truncated = original.slice(0, 2); // fork right after the first exchange

    // No preceding updateCurrent() call — forkCurrent must sync `original` onto
    // the current session itself, in the same write that seeds the fork.
    const forked = store.forkCurrent(original, truncated, 'Fork of test');

    // The new session is now current, seeded with a full-fidelity copy.
    expect(store.getCurrent().id).toBe(forked.id);
    expect(store.getCurrent().title).toBe('Fork of test');
    expect(store.getCurrent().messages).toEqual(truncated);

    // The original full conversation survives as its own past session.
    const past = store.list();
    expect(past).toHaveLength(1);
    expect(past[0].messageCount).toBe(original.length);
  });

  it('caps at MAX_SESSIONS, evicting the oldest session like startNew()', () => {
    const store = new SessionStore(filePath);
    for (let i = 0; i < MAX_SESSIONS + 2; i++) {
      const msgs: ChatMessage[] = [{ role: 'user', content: `msg ${i}` }];
      store.forkCurrent(msgs, msgs, `session ${i}`);
    }
    expect(store.list().length).toBeLessThan(MAX_SESSIONS);
  });

  it('truncates oversized messages the same way updateCurrent does, for both the synced current and the fork', () => {
    const store = new SessionStore(filePath);
    const huge = 'x'.repeat(9_000);
    const hugeMsgs: ChatMessage[] = [{ role: 'user', content: huge }];
    store.forkCurrent(hugeMsgs, hugeMsgs, 'big');

    expect(store.getCurrent().messages[0].content.length).toBeLessThan(9_000);
    expect(store.getCurrent().messages[0].content.endsWith('…')).toBe(true);

    const past = store.list();
    expect(past).toHaveLength(1);
  });
});
