import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool
} from '../mcp/tools/fileSystem.js';
import * as vscode from 'vscode';
import { executeTerminalCommand } from '../mcp/tools/terminal.js';
import { backgroundProcesses } from '../../services/background-processes.js';
import { gitStatus, gitDiff, gitLog } from '../mcp/tools/git.js';
import { webSearch } from '../mcp/tools/webSearch.js';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  /** JSON Schema complet pour les paramètres de type array/object (types complexes MCP). */
  jsonSchema?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** Type d'action HITL correspondant (terminal, write_file, read_file...). */
  hitlAction: string;
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
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

  /** Crée une copie du registre d'outils. */
  public clone(): ToolRegistry {
    const cloned = new ToolRegistry();
    for (const tool of this.tools.values()) {
      cloned.register(tool);
    }
    return cloned;
  }

  /** Conserve uniquement les outils correspondants aux préfixes autorisés. */
  public restrictTo(allowedPrefixes: string[]): void {
    const all = Array.from(this.tools.keys());
    for (const name of all) {
      const allowed = allowedPrefixes.some(prefix => name === prefix || name.startsWith(prefix));
      if (!allowed) {
        this.tools.delete(name);
      }
    }
  }

  /** Description compacte des outils, injectée dans le prompt système. */
  public describeForPrompt(): string {
    return this.list()
      .map(tool => {
        const params = tool.parameters
          .map(p => {
            if ((p.type === 'array' || p.type === 'object') && p.jsonSchema) {
              return `${p.name}${p.required ? '' : '?'}: ${JSON.stringify(p.jsonSchema)} (${p.description})`;
            }
            return `${p.name}${p.required ? '' : '?'}: ${p.type} (${p.description})`;
          })
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

function bool(args: Record<string, unknown>, key: string): boolean {
  const v = args[key];
  return v === true || v === 'true';
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
      name: 'single_find_and_replace',
      description:
        'Remplace une chaîne exacte dans un fichier. Échoue si old_string est absent ou non unique (utilise replace_all pour remplacer toutes les occurrences). Préfère cet outil à edit_existing_file pour les petites modifications ciblées.',
      parameters: [
        { name: 'path', type: 'string', description: 'chemin relatif au workspace', required: true },
        { name: 'old_string', type: 'string', description: 'texte exact à remplacer', required: true },
        { name: 'new_string', type: 'string', description: 'texte de remplacement', required: true },
        { name: 'replace_all', type: 'boolean', description: 'remplacer toutes les occurrences (défaut false)', required: false }
      ],
      hitlAction: 'edit_file',
      execute: async args => {
        const path = str(args, 'path');
        const oldString = str(args, 'old_string');
        const newString = str(args, 'new_string');
        if (!oldString) throw new Error('single_find_and_replace: old_string vide');
        const content = await readFileTool(path);
        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 0) {
          throw new Error(`old_string introuvable dans ${path} — relis le fichier pour copier le texte exact`);
        }
        if (occurrences > 1 && !bool(args, 'replace_all')) {
          throw new Error(
            `old_string présent ${occurrences} fois dans ${path} — élargis le contexte pour le rendre unique ou passe replace_all=true`
          );
        }
        const updated = bool(args, 'replace_all')
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);
        await writeFileTool(path, updated);
        return `Remplacement effectué dans ${path} (${occurrences} occurrence${occurrences > 1 ? 's' : ''})`;
      }
    },
    {
      name: 'read_currently_open_file',
      description:
        'Lit le fichier actuellement ouvert dans l\'éditeur VS Code. Utile quand l\'utilisateur parle de « ce fichier » sans donner de chemin.',
      parameters: [],
      hitlAction: 'read_file',
      execute: async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return '(aucun fichier ouvert dans l\'éditeur)';
        const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const text = editor.document.getText();
        const truncated = text.length > 20_000 ? text.slice(0, 20_000) + '\n… (tronqué)' : text;
        return `Fichier ouvert: ${relPath}\n\n${truncated}`;
      }
    },
    {
      name: 'grep_search',
      description:
        'Recherche une expression régulière dans les fichiers du workspace (max 50 résultats, format chemin:ligne: texte)',
      parameters: [
        { name: 'pattern', type: 'string', description: 'expression régulière (insensible à la casse)', required: true },
        { name: 'glob', type: 'string', description: 'filtre optionnel, ex: src/**/*.ts', required: false }
      ],
      hitlAction: 'read_file',
      execute: async args => {
        const pattern = str(args, 'pattern');
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, 'i');
        } catch (err) {
          throw new Error(`Regex invalide: ${err instanceof Error ? err.message : err}`);
        }
        const glob = str(args, 'glob');
        const globRegex = glob ? globToRegex(glob) : null;
        const items = await listDirectoryTool('.', true);
        const files = items.filter(
          i => !i.isDirectory && i.size <= 512 * 1024 && (!globRegex || globRegex.test(i.path))
        );
        const matches: string[] = [];
        for (const file of files) {
          if (matches.length >= 50) break;
          let content: string;
          try {
            content = await readFileTool(file.path);
          } catch {
            continue; // fichier bloqué par le sandbox ou illisible
          }
          const lines = content.split('\n');
          for (let l = 0; l < lines.length && matches.length < 50; l++) {
            if (regex.test(lines[l])) {
              matches.push(`${file.path}:${l + 1}: ${lines[l].trim().slice(0, 200)}`);
            }
          }
        }
        return matches.join('\n') || '(aucune correspondance)';
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
      execute: async (args, signal) => {
        const result = await executeTerminalCommand(str(args, 'command'), { signal });
        const output = `${result.stdout}${result.stderr}`.trim();
        return [
          output || '(aucune sortie)',
          result.timedOut ? '[TIMEOUT]' : `[exit code: ${result.exitCode}]`
        ].join('\n');
      }
    },
    {
      name: 'run_in_background',
      description:
        'Lance une commande shell en arrière-plan (serveur de dev, watcher, tâche longue) et retourne immédiatement son id. Utilise check_background_process pour lire sa sortie et stop_background_process pour l\'arrêter — jamais Ctrl+C.',
      parameters: [
        { name: 'command', type: 'string', description: 'commande à lancer en arrière-plan', required: true }
      ],
      hitlAction: 'terminal',
      execute: async args => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const status = backgroundProcesses.start(str(args, 'command'), cwd);
        return `Processus lancé en arrière-plan: id=${status.id}, pid=${status.pid ?? '?'} — ${status.command}`;
      }
    },
    {
      name: 'check_background_process',
      description: 'Statut et sortie récente d\'un processus lancé avec run_in_background (sans id: liste tous les processus)',
      parameters: [
        { name: 'id', type: 'string', description: 'id retourné par run_in_background', required: false }
      ],
      hitlAction: 'read_file',
      execute: async args => {
        const id = str(args, 'id');
        if (!id) {
          const all = backgroundProcesses.list();
          if (all.length === 0) return '(aucun processus en arrière-plan)';
          return all
            .map(p => `${p.id} [${p.running ? 'running' : `exit ${p.exitCode}`}] ${p.command}`)
            .join('\n');
        }
        const status = backgroundProcesses.status(id);
        if (!status) return `Processus inconnu: ${id}`;
        return [
          `${status.id} [${status.running ? 'running' : `exit ${status.exitCode}`}] ${status.command}`,
          status.output.trim() || '(aucune sortie pour l\'instant)'
        ].join('\n---\n');
      }
    },
    {
      name: 'stop_background_process',
      description: 'Arrête un processus lancé avec run_in_background',
      parameters: [
        { name: 'id', type: 'string', description: 'id retourné par run_in_background', required: true }
      ],
      hitlAction: 'terminal',
      execute: async args => {
        const id = str(args, 'id');
        return backgroundProcesses.stop(id)
          ? `Processus ${id} arrêté.`
          : `Processus ${id} introuvable ou déjà terminé.`;
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
