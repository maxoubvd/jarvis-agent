import { describe, it, expect } from 'vitest';
import { loadRules, renderRules } from '../../src/backend/services/rules.js';
import type { JarvisConfig } from '../../src/backend/config/config-manager.js';

function config(rules: JarvisConfig['rules']): JarvisConfig {
  return { version: 1, models: { default: null, items: [] }, rules };
}

describe('rules service', () => {
  it('keeps only enabled, non-empty rules', () => {
    const rules = loadRules(
      config([
        { id: '1', name: 'a', enabled: true, content: 'Always add tests' },
        { id: '2', name: 'b', enabled: false, content: 'Disabled rule' },
        { id: '3', name: 'c', enabled: true, content: '   ' }
      ])
    );
    expect(rules).toHaveLength(1);
    expect(rules[0].content).toBe('Always add tests');
  });

  it('handles a config without rules', () => {
    expect(loadRules(config(undefined))).toEqual([]);
  });

  it('renders rules as a bullet list block', () => {
    const text = renderRules([
      { id: '1', name: 'a', enabled: true, content: 'Rule one' },
      { id: '2', name: 'b', enabled: true, content: 'Rule two' }
    ]);
    expect(text).toContain('USER RULES');
    expect(text).toContain('- Rule one');
    expect(text).toContain('- Rule two');
  });

  it('renders empty string when no rules', () => {
    expect(renderRules([])).toBe('');
  });
});
