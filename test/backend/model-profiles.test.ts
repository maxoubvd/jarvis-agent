import { describe, it, expect } from 'vitest';
import { resolveProfile, effectiveTemperature, defaultContextLength } from '../../src/backend/services/model-profiles.js';

describe('model profiles (spec §7 — optimisation petits modèles)', () => {
  it('matches devstral on the API id or the display name', () => {
    expect(resolveProfile({ model: 'devstral-small-2507', name: 'Dev' })?.id).toBe('devstral');
    expect(resolveProfile({ model: 'mistralai/devstral-small', name: 'x' })?.id).toBe('devstral');
    expect(resolveProfile({ model: 'foo', name: 'Devstral local' })?.id).toBe('devstral');
    expect(resolveProfile({ model: 'devstral', name: '' })?.promptStyle).toBe('agentic-rich');
    expect(resolveProfile({ model: 'devstral', name: '' })?.personaExtra).toContain('méthodique');
  });

  it('matches codestral', () => {
    const profile = resolveProfile({ model: 'codestral-latest', name: 'Codestral' });
    expect(profile?.id).toBe('codestral');
    expect(profile?.temperature).toBe(0.1);
  });

  it('matches qwen coder variants with the compact-json style', () => {
    for (const id of ['qwen2.5-coder:7b', 'Qwen/Qwen2.5-Coder-7B-Instruct', 'qwen-coder']) {
      const profile = resolveProfile({ model: id, name: '' });
      expect(profile?.id).toBe('qwen-coder');
      expect(profile?.promptStyle).toBe('compact-json');
      expect(profile?.maxToolResultChars).toBe(4000);
    }
    // Le nom d'affichage suffit (id API opaque).
    expect(resolveProfile({ model: 'local-model', name: 'Qwen 2.5 Coder 7B (Local)' })?.id).toBe('qwen-coder');
  });

  it('returns null for unknown models', () => {
    expect(resolveProfile({ model: 'gpt-4o-mini', name: 'GPT' })).toBeNull();
    expect(resolveProfile(null)).toBeNull();
  });

  it('effectiveTemperature: user setting wins over the profile', () => {
    expect(effectiveTemperature({ model: 'codestral-latest', name: '' })).toBe(0.1);
    expect(effectiveTemperature({ model: 'codestral-latest', name: '', temperature: 0.7 })).toBe(0.7);
    expect(effectiveTemperature({ model: 'gpt-4o-mini', name: '' })).toBeUndefined();
  });

  it('defaultContextLength: known families get a conservative context window', () => {
    expect(defaultContextLength({ model: 'devstral-small-2507', name: '' })).toBe(128_000);
    expect(defaultContextLength({ model: 'codestral-latest', name: 'Codestral' })).toBe(32_768);
    expect(defaultContextLength({ model: 'qwen2.5-coder:7b', name: '' })).toBe(32_768);
    expect(defaultContextLength({ model: 'mistral-large-latest', name: '' })).toBe(128_000);
    expect(defaultContextLength({ model: 'deepseek-coder:6.7b', name: '' })).toBe(16_384);
    // Le nom d'affichage suffit (id API opaque).
    expect(defaultContextLength({ model: 'local-model', name: 'Codestral 22B' })).toBe(32_768);
  });

  it('defaultContextLength: devstral is not caught by the generic mistral patterns', () => {
    expect(defaultContextLength({ model: 'mistralai/devstral-small', name: '' })).toBe(128_000);
  });

  it('defaultContextLength: null for unknown models', () => {
    expect(defaultContextLength({ model: 'gpt-4o-mini', name: 'GPT' })).toBeNull();
    expect(defaultContextLength(null)).toBeNull();
    expect(defaultContextLength(undefined)).toBeNull();
  });
});
