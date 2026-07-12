import { describe, it, expect } from 'vitest';
import { extractJson, stripThinking, findBalancedJson } from '../../src/backend/core/utils/json-cleaner.js';

describe('JSON Cleaner (spec §8.2)', () => {
  it('parses clean JSON directly', () => {
    const result = extractJson<{ a: number }>('{"a": 1}');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ a: 1 });
  });

  it('extracts JSON from markdown fences', () => {
    const raw = 'Here is the answer:\n```json\n{"tool": "read_file"}\n```\nend';
    const result = extractJson<{ tool: string }>(raw);
    expect(result.ok).toBe(true);
    expect(result.value?.tool).toBe('read_file');
  });

  it('extracts JSON surrounded by prose', () => {
    const raw = 'I will read the file. {"action": {"tool": "read_file", "args": {"path": "a.ts"}}} There.';
    const result = extractJson(raw);
    expect(result.ok).toBe(true);
    expect((result.value as Record<string, unknown>).action).toBeDefined();
  });

  it('strips <thinking> blocks and keeps them separately', () => {
    const { text, thinking } = stripThinking('<thinking>thinking</thinking>{"a":1}');
    expect(thinking).toBe('thinking');
    expect(text).toBe('{"a":1}');
  });

  it('repairs trailing commas', () => {
    const result = extractJson('{"items": [1, 2,], "name": "x",}');
    expect(result.ok).toBe(true);
    expect((result.value as { items: number[] }).items).toEqual([1, 2]);
  });

  it('handles nested braces inside strings', () => {
    const json = findBalancedJson('x {"code": "if (a) { b() }"} y');
    expect(json).toBe('{"code": "if (a) { b() }"}');
  });

  it('returns surroundingText when no JSON found', () => {
    const result = extractJson('Juste du texte sans JSON.');
    expect(result.ok).toBe(false);
    expect(result.surroundingText).toBe('Juste du texte sans JSON.');
  });

  it('handles escaped quotes in strings', () => {
    const result = extractJson('{"msg": "il a dit \\"bonjour\\""}');
    expect(result.ok).toBe(true);
    expect((result.value as { msg: string }).msg).toBe('il a dit "bonjour"');
  });
});
