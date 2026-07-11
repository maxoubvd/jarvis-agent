import { describe, it, expect } from 'vitest';
import { buildCompletionPrompt, extractCompletionText } from '../../src/backend/core/autocomplete/prompt.js';

describe('buildCompletionPrompt', () => {
  it('places the prefix and suffix around a <CURSOR> marker in the user message', () => {
    const messages = buildCompletionPrompt('const x = ', ';\nconsole.log(x);', 'typescript');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('typescript');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('const x = <CURSOR>;\nconsole.log(x);');
  });
});

describe('extractCompletionText', () => {
  it('trims plain text responses', () => {
    expect(extractCompletionText('  1 + 2  \n')).toBe('1 + 2');
  });

  it('strips a markdown code fence, with or without a language tag', () => {
    expect(extractCompletionText('```ts\nconst y = 2;\n```')).toBe('const y = 2;');
    expect(extractCompletionText('```\nplain\n```')).toBe('plain');
  });

  it('removes a hallucinated <CURSOR> marker instead of re-inserting it', () => {
    expect(extractCompletionText('foo<CURSOR>bar')).toBe('foobar');
  });

  it('returns an empty string for an empty/whitespace-only response', () => {
    expect(extractCompletionText('')).toBe('');
    expect(extractCompletionText('   \n  ')).toBe('');
  });
});
