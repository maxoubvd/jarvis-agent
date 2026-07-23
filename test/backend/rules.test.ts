import { describe, it, expect } from 'vitest';
import { loadRules, renderRules } from '../../packages/core/src/services/rules.js';
import type { JarvisConfig } from '../../packages/core/src/config/config-manager.js';

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

  it('always includes unscoped rules regardless of the active file', () => {
    const rules = loadRules(
      config([{ id: '1', name: 'a', enabled: true, content: 'Global rule' }]),
      'src/frontend/App.svelte'
    );
    expect(rules).toHaveLength(1);
  });

  it('includes a scoped rule only when the active file matches the glob', () => {
    const cfg = config([
      { id: '1', name: 'backend-only', enabled: true, content: 'Backend rule', scope: 'src/backend/**' }
    ]);
    expect(loadRules(cfg, 'src/backend/core/extension.ts')).toHaveLength(1);
    expect(loadRules(cfg, 'src/frontend/App.svelte')).toHaveLength(0);
  });

  it('excludes scoped rules when there is no active file (e.g. workflow runs)', () => {
    const cfg = config([
      { id: '1', name: 'backend-only', enabled: true, content: 'Backend rule', scope: 'src/backend/**' }
    ]);
    expect(loadRules(cfg)).toHaveLength(0);
    expect(loadRules(cfg, null)).toHaveLength(0);
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
