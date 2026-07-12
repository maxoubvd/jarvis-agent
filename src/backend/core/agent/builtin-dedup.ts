/**
 * Deduplication of built-in tools duplicated by a connected MCP server:
 * when the `filesystem` or `git` server exposes an equivalent, the builtin is
 * hidden (registry + Settings > Agent tools) in favor of the MCP tool. If the
 * server is disabled, unreachable, or the tool is excluded, the builtin stays —
 * the agent never loses capability.
 *
 * Documented limitations: the file builtins go through the SandboxManager
 * (.jarvisignore, symlinks) and the ChangeTracker (diff review); the MCP
 * filesystem server is confined to the workspace but honors neither of these —
 * the MCP tools' default `ask` HITL policy acts as the safety net.
 */

export interface BuiltinEquivalent {
  /** Id of the MCP server (builtin.ts) providing the equivalent. */
  server: string;
  /** Possible names of the equivalent tool (upstream names drift between versions). */
  anyOf: string[];
}

/** builtin → MCP equivalent. A builtin absent from here is never hidden. */
export const BUILTIN_MCP_EQUIVALENTS: Record<string, BuiltinEquivalent> = {
  // `read_file` is the deprecated alias for `read_text_file` in recent
  // versions of @modelcontextprotocol/server-filesystem.
  read_file: { server: 'filesystem', anyOf: ['read_text_file', 'read_file'] },
  create_new_file: { server: 'filesystem', anyOf: ['write_file'] },
  edit_existing_file: { server: 'filesystem', anyOf: ['edit_file'] },
  ls: { server: 'filesystem', anyOf: ['list_directory'] },
  file_glob_search: { server: 'filesystem', anyOf: ['search_files'] },
  git_status: { server: 'git', anyOf: ['git_status'] },
  git_log: { server: 'git', anyOf: ['git_log'] },
  view_diff: { server: 'git', anyOf: ['git_diff_unstaged', 'git_diff'] }
};

/** Tools actually available per connected MCP server (see `McpManager.activeToolNames`). */
export type ActiveMcpTools = ReadonlyMap<string, ReadonlySet<string>>;

/** True if a connected MCP server exposes an active equivalent of this builtin. */
export function isBuiltinShadowed(builtinName: string, active: ActiveMcpTools): boolean {
  const eq = BUILTIN_MCP_EQUIVALENTS[builtinName];
  if (!eq) return false;
  const tools = active.get(eq.server);
  return !!tools && eq.anyOf.some(name => tools.has(name));
}
