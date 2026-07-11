import { describe, it, expect } from 'vitest';
import { resolveProfile, effectiveTemperature } from '../../src/backend/services/model-profiles.js';

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
});
