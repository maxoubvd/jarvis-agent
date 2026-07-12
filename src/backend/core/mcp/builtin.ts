import * as fs from 'fs';
import * as path from 'path';
import type { McpServerConfig } from '../../config/config-manager.js';

/**
 * True if `folder` is ITSELF the root of a git repository (has its own
 * `.git`) — not just a subfolder of a parent repo. The `git` CLI walks up
 * parent directories to find a `.git`, but `mcp-server-git` strictly checks
 * the given path and fails otherwise ("not a valid Git repository").
 */
export function isGitRepository(folder?: string): boolean {
  if (!folder) return false;
  try {
    return fs.existsSync(path.join(folder, '.git'));
  } catch {
    return false;
  }
}

/**
 * A "built-in" MCP server: defined in code, visible to all users in Settings
 * (spec §4.1), can be enabled/disabled but is neither editable nor
 * removable — the enable override lives in `config.builtinMcp[id].enabled`.
 */
export interface BuiltinMcpServer {
  id: string;
  label: string;
  description: string;
  /** `config.enabled` = default activation (before user override). */
  config: McpServerConfig;
  /** Server implemented in the extension (InMemoryTransport pair, no process). */
  inProcess?: boolean;
  /** Can only connect if a folder is open (the manager forces enabled=false otherwise). */
  requiresWorkspace?: boolean;
  /** Can only connect if the open folder is ITSELF a git repository root (see `isGitRepository`). */
  requiresOwnGitRepo?: boolean;
}

/**
 * The 4 built-in servers, always listed (even without an open folder) so the
 * Settings UI stays complete. memory/filesystem run via npx (Node is
 * enough), fetch is implemented in-process in the extension; git is the
 * official Python server (uvx), enabled by default as soon as the open
 * folder is ITSELF a git repository (`isGitRepository`) — otherwise
 * `mcp-server-git` fails with "not a valid Git repository" (it doesn't walk
 * up to a parent repo the way the `git` CLI does). In that case the server
 * stays disabled by default; enabling it manually goes through the "git
 * init" flow (extension.ts, `requestGitInit` message). If the connection
 * still fails, the manager isolates the error per server and the native git
 * tools (git_status, git_log, view_diff) remain available (builtin-dedup.ts).
 */
export function getBuiltinMcpServers(workspaceFolder?: string): BuiltinMcpServer[] {
  return [
    {
      id: 'memory',
      label: 'Memory (Knowledge Graph)',
      description:
        'Persistent knowledge graph: entities, relations, observations (create_entities, search_nodes…).',
      config: {
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory']
      }
    },
    {
      id: 'filesystem',
      label: 'Filesystem',
      description:
        'File operations scoped to the current workspace folder.' +
        (workspaceFolder ? '' : ' (requires an open folder)'),
      requiresWorkspace: true,
      config: {
        enabled: !!workspaceFolder,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', ...(workspaceFolder ? [workspaceFolder] : [])]
      }
    },
    {
      id: 'git',
      label: 'Git',
      description:
        'Git operations on the current repository (status, diff, commit, branch…). Requires Python + uv (uvx).' +
        (!workspaceFolder ? ' (requires an open folder)' : !isGitRepository(workspaceFolder) ? ' (this folder isn\'t a git repository)' : ''),
      requiresWorkspace: true,
      requiresOwnGitRepo: true,
      config: {
        enabled: !!workspaceFolder && isGitRepository(workspaceFolder),
        transport: 'stdio',
        command: 'uvx',
        args: ['mcp-server-git', ...(workspaceFolder ? ['--repository', workspaceFolder] : [])]
      }
    },
    {
      id: 'fetch',
      label: 'Fetch (URL)',
      description:
        'Fetches web page content as markdown. Built into the extension — no external dependency.',
      inProcess: true,
      config: {
        enabled: true,
        transport: 'stdio'
      }
    }
  ];
}

/** Human-readable representation of the command (shown in Settings). */
export function builtinCommandString(server: BuiltinMcpServer): string {
  if (server.inProcess) return '(built-in)';
  return [server.config.command, ...(server.config.args ?? [])].join(' ');
}
