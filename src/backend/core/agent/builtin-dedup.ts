/**
 * Déduplication des outils intégrés doublonnés par un serveur MCP connecté :
 * quand le serveur `filesystem` ou `git` expose un équivalent, le builtin est
 * masqué (registre + Settings > Agent tools) au profit du tool MCP. Serveur
 * désactivé, injoignable ou tool exclu → le builtin reste, l'agent ne perd
 * jamais de capacité.
 *
 * Limites documentées : les builtins fichiers passent par le SandboxManager
 * (.jarvisignore, symlinks) et le ChangeTracker (diff review) ; le serveur MCP
 * filesystem est confiné au workspace mais n'honore ni l'un ni l'autre — la
 * politique HITL `ask` par défaut des tools MCP sert de garde-fou.
 */

export interface BuiltinEquivalent {
  /** Id du serveur MCP (builtin.ts) fournissant l'équivalent. */
  server: string;
  /** Noms possibles du tool équivalent (les noms upstream dérivent entre versions). */
  anyOf: string[];
}

/** builtin → équivalent MCP. Un builtin absent d'ici n'est jamais masqué. */
export const BUILTIN_MCP_EQUIVALENTS: Record<string, BuiltinEquivalent> = {
  // `read_file` est l'alias déprécié de `read_text_file` dans les versions
  // récentes de @modelcontextprotocol/server-filesystem.
  read_file: { server: 'filesystem', anyOf: ['read_text_file', 'read_file'] },
  create_new_file: { server: 'filesystem', anyOf: ['write_file'] },
  edit_existing_file: { server: 'filesystem', anyOf: ['edit_file'] },
  ls: { server: 'filesystem', anyOf: ['list_directory'] },
  file_glob_search: { server: 'filesystem', anyOf: ['search_files'] },
  git_status: { server: 'git', anyOf: ['git_status'] },
  git_log: { server: 'git', anyOf: ['git_log'] },
  view_diff: { server: 'git', anyOf: ['git_diff_unstaged', 'git_diff'] }
};

/** Tools réellement disponibles par serveur MCP connecté (voir `McpManager.activeToolNames`). */
export type ActiveMcpTools = ReadonlyMap<string, ReadonlySet<string>>;

/** True si un serveur MCP connecté expose un équivalent actif de ce builtin. */
export function isBuiltinShadowed(builtinName: string, active: ActiveMcpTools): boolean {
  const eq = BUILTIN_MCP_EQUIVALENTS[builtinName];
  if (!eq) return false;
  const tools = active.get(eq.server);
  return !!tools && eq.anyOf.some(name => tools.has(name));
}
