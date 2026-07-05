import { describe, it, expect } from 'vitest';
import { SecretScrubber } from '../../src/backend/core/utils/scrubber.js';

describe('SecretScrubber', () => {
  const scrubber = new SecretScrubber();

  it('redacts OpenAI-style API keys', () => {
    const input = 'Voici ma clé sk-abcdef1234567890abcdef1234567890abcd et le reste.';
    const { cleaned, foundSecrets } = scrubber.scrub(input);
    expect(cleaned).not.toContain('sk-abcdef1234567890');
    expect(foundSecrets.length).toBeGreaterThan(0);
  });

  it('redacts AWS access keys', () => {
    const { cleaned } = scrubber.scrub('key=AKIAIOSFODNN7EXAMPLE');
    expect(cleaned).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts GitHub tokens', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    const { cleaned } = scrubber.scrub(`token: ${token}`);
    expect(cleaned).not.toContain(token);
  });

  it('leaves clean text untouched', () => {
    const input = 'const sum = (a, b) => a + b;';
    const { cleaned, foundSecrets } = scrubber.scrub(input);
    expect(cleaned).toBe(input);
    expect(foundSecrets).toHaveLength(0);
  });

  it('detects presence of secrets via hasSecrets', () => {
    expect(scrubber.hasSecrets('password: supersecret123')).toBe(true);
    expect(scrubber.hasSecrets('just some code')).toBe(false);
  });
});
