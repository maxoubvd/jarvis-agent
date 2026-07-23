import { describe, it, expect } from 'vitest';
import { TokenCounter } from '../../packages/core/src/services/token-counter.js';

describe('TokenCounter cached tokens', () => {
  it('accumulates cachedTokens across requests', () => {
    const tc = new TokenCounter(10000);
    tc.addRequest('m', 100, 20, 60);
    tc.addRequest('m', 200, 30, 40);
    const usage = tc.getUsage();
    expect(usage.cachedTokens).toBe(100);
    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(50);
  });

  it('defaults cachedTokens to 0 when omitted', () => {
    const tc = new TokenCounter();
    tc.addRequest('m', 10, 5);
    expect(tc.getUsage().cachedTokens).toBe(0);
    expect(tc.getUsage().history[0].cachedTokens).toBeUndefined();
  });
});

describe('TokenCounter serialize/restore (session persistence)', () => {
  it('round-trips the counter state', () => {
    const tc = new TokenCounter(8000);
    tc.addRequest('gpt', 500, 120, 200);
    tc.addRequest('gpt', 300, 80, 0);
    const snapshot = tc.serialize();

    const restored = new TokenCounter();
    restored.setLimit(8000);
    restored.restore(snapshot);

    const a = tc.getUsage();
    const b = restored.getUsage();
    expect(b.inputTokens).toBe(a.inputTokens);
    expect(b.outputTokens).toBe(a.outputTokens);
    expect(b.cachedTokens).toBe(a.cachedTokens);
    expect(b.history).toHaveLength(a.history.length);
    expect(b.used).toBe(a.used);
  });

  it('restore(null) is a no-op and does not touch the limit', () => {
    const tc = new TokenCounter(4096);
    tc.addRequest('m', 100, 50);
    tc.restore(null);
    const usage = tc.getUsage();
    expect(usage.inputTokens).toBe(100);
    expect(usage.limit).toBe(4096);
  });

  it('restore does not overwrite the current model limit', () => {
    const tc = new TokenCounter();
    tc.setLimit(16000); // current model limit
    tc.restore({ inputTokens: 10, outputTokens: 5, cachedTokens: 2, history: [] });
    expect(tc.getUsage().limit).toBe(16000);
    expect(tc.getUsage().cachedTokens).toBe(2);
  });

  it('reset clears cached tokens too', () => {
    const tc = new TokenCounter(1000);
    tc.addRequest('m', 100, 50, 30);
    tc.reset();
    const usage = tc.getUsage();
    expect(usage.cachedTokens).toBe(0);
    expect(usage.used).toBe(0);
  });
});
