import { describe, it, expect } from 'vitest';
import {
  matchTrigger,
  filterCommands,
  SLASH_COMMANDS,
  AT_MENTIONS
} from '../../src/frontend/shared/commands.js';

describe('matchTrigger', () => {
  it('detects "/" only at the very start of the input', () => {
    expect(matchTrigger('/', 1)).toEqual({ trigger: '/', tokenStart: 0, partial: '' });
    expect(matchTrigger('/ag', 3)).toEqual({ trigger: '/', tokenStart: 0, partial: 'ag' });
    // '/' mid-text is a path, not a command
    expect(matchTrigger('src/', 4)).toBeNull();
    expect(matchTrigger('hello /a', 8)).toBeNull();
  });

  it('detects "@" at start or after whitespace', () => {
    expect(matchTrigger('@', 1)).toEqual({ trigger: '@', tokenStart: 0, partial: '' });
    expect(matchTrigger('lis @fi', 7)).toEqual({ trigger: '@', tokenStart: 4, partial: 'fi' });
    expect(matchTrigger('a\n@d', 4)).toEqual({ trigger: '@', tokenStart: 2, partial: 'd' });
    // '@' inside a word (email) does not trigger
    expect(matchTrigger('user@host', 9)).toBeNull();
  });

  it('returns null when the current token is already terminated by a space', () => {
    expect(matchTrigger('/agent fix', 10)).toBeNull();
    expect(matchTrigger('@read x', 7)).toBeNull();
  });

  it('uses the caret position, not the end of the text', () => {
    // caret right after '@f', with trailing text beyond
    const m = matchTrigger('@f rest', 2);
    expect(m).toEqual({ trigger: '@', tokenStart: 0, partial: 'f' });
  });
});

describe('filterCommands', () => {
  it('returns all slash commands for a bare "/"', () => {
    const m = matchTrigger('/', 1)!;
    expect(filterCommands(m)).toHaveLength(SLASH_COMMANDS.length);
  });

  it('filters by prefix, case-insensitive', () => {
    const m = matchTrigger('/td', 3)!;
    const items = filterCommands(m);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/tdd');

    const qa = filterCommands(matchTrigger('@qa', 3)!);
    expect(qa).toHaveLength(1);
    expect(qa[0].label).toBe('@QA-Agent');
  });

  it('returns all mentions for a bare "@"', () => {
    const m = matchTrigger('@', 1)!;
    expect(filterCommands(m)).toHaveLength(AT_MENTIONS.length);
  });

  it('returns empty for an unknown token', () => {
    expect(filterCommands(matchTrigger('/zzz', 4)!)).toHaveLength(0);
  });

  it('suggests /rollback', () => {
    const items = filterCommands(matchTrigger('/roll', 5)!);
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('/rollback');
  });
});
