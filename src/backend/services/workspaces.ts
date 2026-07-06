import type { JarvisConfig, WorkspaceProfile } from '../config/config-manager.js';

/**
 * Profils de workspace (Settings > Workspaces) : un profil porte des
 * instructions type CLAUDE.md injectées dans le prompt système quand il est
 * actif (sélecteur dans l'onglet Chat). Pur (pas de vscode) — testable.
 */

/** Profil actif : doit exister ET être activé, sinon null. */
export function getActiveWorkspace(config: JarvisConfig): WorkspaceProfile | null {
  const id = config.activeWorkspaceId;
  if (!id) return null;
  return (config.workspaces ?? []).find(w => w.id === id && w.enabled) ?? null;
}

/** Bloc d'instructions injecté dans le prompt système (style renderRules). */
export function renderWorkspaceInstructions(profile: WorkspaceProfile | null): string {
  if (!profile || !profile.instructions.trim()) return '';
  return `--- WORKSPACE: ${profile.name} ---\n${profile.instructions.trim()}`;
}
