import type { JarvisConfig, WorkspaceProfile } from '../config/config-manager.js';

/**
 * Workspace profiles (Settings > Workspaces): a profile holds CLAUDE.md-style
 * instructions injected into the system prompt when active
 * (selector in the Chat tab). Pure (no vscode) — testable.
 */

/** Active profile: must exist AND be enabled, otherwise null. */
export function getActiveWorkspace(config: JarvisConfig): WorkspaceProfile | null {
  const id = config.activeWorkspaceId;
  if (!id) return null;
  return (config.workspaces ?? []).find(w => w.id === id && w.enabled) ?? null;
}

/** Instruction block injected into the system prompt (renderRules style). */
export function renderWorkspaceInstructions(profile: WorkspaceProfile | null): string {
  if (!profile || !profile.instructions.trim()) return '';
  return `--- WORKSPACE: ${profile.name} ---\n${profile.instructions.trim()}`;
}
