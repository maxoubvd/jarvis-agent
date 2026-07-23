import { describe, it, expect } from 'vitest';
import { renderHome } from '../src/home.js';
import { strip } from '../src/theme.js';

describe('CLI home page', () => {
  it('shows the active model, provider, workspace and HITL mode', () => {
    const out = strip(
      renderHome({
        model: 'qwen2.5-coder',
        provider: 'ollama',
        workspace: '/home/me/project',
        hitlMode: 'moderate',
        needsSetup: false
      })
    );
    expect(out).toContain('qwen2.5-coder');
    expect(out).toContain('ollama');
    expect(out).toContain('/home/me/project');
    expect(out).toContain('moderate');
    expect(out).toContain('autonomous software engineer');
    // Command hints are part of the landing page.
    expect(out).toContain('/agent');
    expect(out).toContain('/settings');
  });

  it('prompts for setup when no model is configured', () => {
    const out = strip(
      renderHome({ model: null, provider: null, workspace: '/tmp', hitlMode: 'strict', needsSetup: true })
    );
    expect(out).toContain('no model configured');
    expect(out).toContain('jarvis settings');
  });
});
