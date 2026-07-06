import { describe, it, expect } from 'vitest';

import {
  getActiveWorkspace,
  renderWorkspaceInstructions
} from '../../src/backend/services/workspaces.js';
import type { JarvisConfig, WorkspaceProfile } from '../../src/backend/config/config-manager.js';

function config(partial: Partial<JarvisConfig>): JarvisConfig {
  return { version: 1, models: { default: null, items: [] }, ...partial };
}

const profile: WorkspaceProfile = {
  id: 'ws-1',
  name: 'API Project',
  folder: 'C:\\dev\\api',
  instructions: 'Stack: Node + Fastify.\nAlways write tests.',
  enabled: true
};

describe('getActiveWorkspace', () => {
  it('returns null when no active id is set', () => {
    expect(getActiveWorkspace(config({ workspaces: [profile] }))).toBeNull();
  });

  it('returns null when the active id does not exist', () => {
    expect(getActiveWorkspace(config({ workspaces: [profile], activeWorkspaceId: 'ghost' }))).toBeNull();
  });

  it('returns null when the active profile is disabled', () => {
    const disabled = { ...profile, enabled: false };
    expect(getActiveWorkspace(config({ workspaces: [disabled], activeWorkspaceId: 'ws-1' }))).toBeNull();
  });

  it('returns the profile when active and enabled', () => {
    const active = getActiveWorkspace(config({ workspaces: [profile], activeWorkspaceId: 'ws-1' }));
    expect(active?.name).toBe('API Project');
  });
});

describe('renderWorkspaceInstructions', () => {
  it('renders a workspace block with the name and trimmed instructions', () => {
    const block = renderWorkspaceInstructions(profile);
    expect(block).toBe('--- WORKSPACE: API Project ---\nStack: Node + Fastify.\nAlways write tests.');
  });

  it('returns an empty string for null or empty instructions', () => {
    expect(renderWorkspaceInstructions(null)).toBe('');
    expect(renderWorkspaceInstructions({ ...profile, instructions: '   ' })).toBe('');
  });
});
