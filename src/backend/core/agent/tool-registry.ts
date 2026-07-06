import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool
} from '../mcp/tools/fileSystem.js';
import { executeTerminalCommand } from '../mcp/tools/terminal.js';
import { gitStatus, gitDiff, gitLog } from '../mcp/tools/git.js';
import { webSearch } from '../mcp/tools/webSearch.js';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** Type d'action HITL correspondant (terminal, write_file, read_file...). */
  hitlAction: string;
  execute(args: Record<string, unknown>): Promise<string>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  public get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Description compacte des outils, injectée dans le prompt système. */
  public describeForPrompt(): string {
    return this.list()
      .map(tool => {
        const params = tool.parameters
          .map(p => `${p.name}${p.required ? '' : '?'}: ${p.type} (${p.description})`)
          .join(', ');
        return `- ${tool.name}(${params}) — ${tool.description}`;
      })
      .join('\n');
  }
}

function str(args: Record<string, unknown>, key: string, fallback = ''): string {
  const v = args[key];
  return typeof v === 'string' ? v : fallback;
}

function num(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Outils intégrés (spec §4.1), tous sandboxés via fileSystem/terminal. */
export function createBuiltinTools(): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: 'Lit le contenu d\'un fichier existant du workspace',
      parameters: [
        { name: 'path', type: 'string', description: 'chemin relatif au workspace', required: true }
      ],
      hitlAction: 'read_file',
      execute: async args => readFileTool(str(args, 'path'))
    },
    {
      name: 'create_new_file',
      description: 'Crée ou remplace un fichier avec le contenu fourni',
      parameters: [
        { name: 'path', type: 'string', description: 'chemin relatif au workspace', required: true },
        { name: 'content', type: 'string', description: 'contenu complet du fichier', required: true }
      ],
      hitlAction: 'write_file',
      execute: async args => {
        await writeFileTool(str(args, 'path'), str(args, 'content'));
        return `Fichier écrit: ${str(args, 'path')}`;
      }
    },
    {
      name: 'edit_existing_file',
      description: 'Remplace les lignes [startLine, endLine] (1-indexées) d\'un fichier par newText',
      parameters: [
        { name: 'path', type: 'string', description: 'chemin relatif au workspace', required: true },
        { name: 'startLine', type: 'number', description: 'première ligne à remplacer', required: true },
        { name: 'endLine', type: 'number', description: 'dernière ligne à remplacer', required: true },
        { name: 'newText', type: 'string', description: 'nouveau texte', required: true }
      ],
      hitlAction: 'edit_file',
      execute: async args => {
        await editFileTool(
          str(args, 'path'),
          num(args, 'startLine', 1),
          num(args, 'endLine', num(args, 'startLine', 1)),
          str(args, 'newText')
        );
        return `Fichier modifié: ${str(args, 'path')}`;
      }
    },
    {
      name: 'ls',
      description: 'Liste les fichiers et dossiers d\'un répertoire du workspace',
      parameters: [
        { name: 'path', type: 'string', description: 'chemin relatif (défaut: racine)', required: false }
      ],
      hitlAction: 'list_directory',
      execute: async args => {
        const items = await listDirectoryTool(str(args, 'path', '.'));
        return items.map(i => `${i.isDirectory ? '[dir] ' : ''}${i.path}`).join('\n') || '(vide)';
      }
    },
    {
      name: 'file_glob_search',
      description: 'Recherche récursive de fichiers par motif glob simple (* et **)',
      parameters: [
        { name: 'pattern', type: 'string', description: 'ex: src/**/*.ts', required: true }
      ],
      hitlAction: 'list_directory',
      execute: async args => {
        const pattern = str(args, 'pattern');
        const items = await listDirectoryTool('.', true);
        const regex = globToRegex(pattern);
        const matches = items
          .filter(i => !i.isDirectory && regex.test(i.path))
          .map(i => i.path)
          .slice(0, 200);
        return matches.join('\n') || '(aucun fichier trouvé)';
      }
    },
    {
      name: 'run_terminal_command',
      description: 'Exécute une commande shell dans le workspace (stdout/stderr capturés, timeout 30s)',
      parameters: [
        { name: 'command', type: 'string', description: 'commande à exécuter', required: true }
      ],
      hitlAction: 'terminal',
      execute: async args => {
        const result = await executeTerminalCommand(str(args, 'command'));
        const output = `${result.stdout}${result.stderr}`.trim();
        return [
          output || '(aucune sortie)',
          result.timedOut ? '[TIMEOUT]' : `[exit code: ${result.exitCode}]`
        ].join('\n');
      }
    },
    {
      name: 'view_diff',
      description: 'Affiche le diff git des changements en cours',
      parameters: [],
      hitlAction: 'read_file',
      execute: async () => (await gitDiff()) || '(aucun changement)'
    },
    {
      name: 'git_status',
      description: 'Affiche le statut git du workspace',
      parameters: [],
      hitlAction: 'read_file',
      execute: async () => (await gitStatus()) || '(arbre de travail propre)'
    },
    {
      name: 'git_log',
      description: 'Affiche les derniers commits',
      parameters: [
        { name: 'limit', type: 'number', description: 'nombre de commits (défaut 10)', required: false }
      ],
      hitlAction: 'read_file',
      execute: async args => gitLog(num(args, 'limit', 10))
    },
    {
      name: 'search_web',
      description: 'Recherche web pour documentation ou connaissances externes',
      parameters: [
        { name: 'query', type: 'string', description: 'requête de recherche', required: true }
      ],
      hitlAction: 'web_search',
      execute: async args => webSearch(str(args, 'query'))
    }
  ];
}

export function globToRegex(pattern: string): RegExp {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '###GLOBSTARSLASH###')
    .replace(/\*\*/g, '###GLOBSTAR###')
    .replace(/\*/g, '[^/]*')
    .replace(/###GLOBSTARSLASH###/g, '(?:.*/)?')
    .replace(/###GLOBSTAR###/g, '.*');
  return new RegExp(`^${regexStr}$`, 'i');
}
