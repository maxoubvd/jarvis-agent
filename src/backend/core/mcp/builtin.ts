import * as fs from 'fs';
import * as path from 'path';
import type { McpServerConfig } from '../../config/config-manager.js';

/**
 * True si `folder` est LUI-MÊME la racine d'un dépôt git (a son propre
 * `.git`) — pas seulement un sous-dossier d'un repo parent. `git` CLI remonte
 * les dossiers parents pour trouver un `.git`, mais `mcp-server-git` vérifie
 * strictement le chemin donné et échoue sinon ("not a valid Git repository").
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
 * Serveur MCP « de base » : défini dans le code, visible pour tous les
 * utilisateurs dans les Settings (spec §4.1), activable/désactivable mais ni
 * éditable ni supprimable — l'override d'activation vit dans
 * `config.builtinMcp[id].enabled`.
 */
export interface BuiltinMcpServer {
  id: string;
  label: string;
  description: string;
  /** `config.enabled` = activation par défaut (avant override utilisateur). */
  config: McpServerConfig;
  /** Serveur implémenté dans l'extension (paire InMemoryTransport, pas de process). */
  inProcess?: boolean;
  /** Ne peut se connecter que si un dossier est ouvert (le manager force enabled=false sinon). */
  requiresWorkspace?: boolean;
  /** Ne peut se connecter que si le dossier ouvert est LUI-MÊME une racine de dépôt git (voir `isGitRepository`). */
  requiresOwnGitRepo?: boolean;
}

/**
 * Les 4 serveurs de base, toujours listés (même sans dossier ouvert) pour que
 * la Settings UI reste complète. memory/filesystem tournent via npx (Node
 * suffit), fetch est implémenté in-process dans l'extension ; git est le
 * serveur officiel Python (uvx), activé par défaut dès que le dossier ouvert
 * est LUI-MÊME un dépôt git (`isGitRepository`) — sinon `mcp-server-git`
 * échoue avec "not a valid Git repository" (il ne remonte pas vers un repo
 * parent comme le fait `git` CLI). Dans ce cas le serveur reste désactivé par
 * défaut ; l'active manuellement passe par le flow "git init" (extension.ts,
 * message `requestGitInit`). Si la connexion échoue quand même, le manager
 * isole l'erreur par serveur et les tools git natifs (git_status, git_log,
 * view_diff) restent disponibles (builtin-dedup.ts).
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

/** Représentation lisible de la commande (affichée dans les Settings). */
export function builtinCommandString(server: BuiltinMcpServer): string {
  if (server.inProcess) return '(built-in)';
  return [server.config.command, ...(server.config.args ?? [])].join(' ');
}
