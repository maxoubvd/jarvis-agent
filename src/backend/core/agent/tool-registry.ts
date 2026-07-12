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
import { globToRegex } from '../utils/glob.js';
import { sanitizeTodoItems } from './todo.js';

/** @deprecated import from `core/utils/glob.js` — re-exported here for backward compat. */
export { globToRegex };

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  /** Full JSON Schema for array/object parameters (complex MCP types). */
  jsonSchema?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** HITL action type for this tool (terminal, write_file, read_file, ...). */
  hitlAction: string;
  /**
   * Tool origin: `restrictTo` never filters `mcp`/`custom` tools
   * (the user explicitly configured them); only `builtin` tools (or untagged ones,
   * for backward compat) are subject to allowed prefixes.
   */
  origin?: 'builtin' | 'custom' | 'mcp';
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

  /** Creates a copy of the tool registry. */
  public clone(): ToolRegistry {
    const cloned = new ToolRegistry();
    for (const tool of this.tools.values()) {
      cloned.register(tool);
    }
    return cloned;
  }

  /**
   * Keeps only builtin tools matching the allowed prefixes.
   * `mcp`/`custom` tools are always kept — the user explicitly configured them,
   * and a persona-level restriction should not hide them.
   */
  public restrictTo(allowedPrefixes: string[]): void {
    for (const [name, tool] of this.tools) {
      if (tool.origin === 'mcp' || tool.origin === 'custom') continue;
      const allowed = allowedPrefixes.some(prefix => name === prefix || name.startsWith(prefix));
      if (!allowed) {
        this.tools.delete(name);
      }
    }
  }

  /** Compact description of the tools, injected into the system prompt. */
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

function strArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (!Array.isArray(v)) return undefined;
  const list = v.filter((x): x is string => typeof x === 'string');
  return list.length > 0 ? list : undefined;
}

/** Built-in tools (spec §4.1), all sandboxed via fileSystem/terminal. */
export function createBuiltinTools(): ToolDefinition[] {
  return [
    {
      name: 'read_file',
      description: 'Reads the content of an existing workspace file',
      parameters: [
        { name: 'path', type: 'string', description: 'path relative to workspace', required: true }
      ],
      hitlAction: 'read_file',
      execute: async args => readFileTool(str(args, 'path'))
    },
    {
      name: 'create_new_file',
      description: 'Creates or overwrites a file with the given content',
      parameters: [
        { name: 'path', type: 'string', description: 'path relative to workspace', required: true },
        { name: 'content', type: 'string', description: 'full file content', required: true }
      ],
      hitlAction: 'write_file',
      execute: async args => {
        await writeFileTool(str(args, 'path'), str(args, 'content'));
        return `File written: ${str(args, 'path')}`;
      }
    },
    {
      name: 'edit_existing_file',
      description: 'Replaces lines [startLine, endLine] (1-indexed) of a file with newText',
      parameters: [
        { name: 'path', type: 'string', description: 'path relative to workspace', required: true },
        { name: 'startLine', type: 'number', description: 'first line to replace', required: true },
        { name: 'endLine', type: 'number', description: 'last line to replace', required: true },
        { name: 'newText', type: 'string', description: 'replacement text', required: true }
      ],
      hitlAction: 'edit_file',
      execute: async args => {
        await editFileTool(
          str(args, 'path'),
          num(args, 'startLine', 1),
          num(args, 'endLine', num(args, 'startLine', 1)),
          str(args, 'newText')
        );
        return `File edited: ${str(args, 'path')}`;
      }
    },
    {
      name: 'single_find_and_replace',
      description:
        'Replaces an exact string in a file. Fails if old_string is absent or not unique (use replace_all to replace all occurrences). Prefer this tool over edit_existing_file for small, targeted changes.',
      parameters: [
        { name: 'path', type: 'string', description: 'path relative to workspace', required: true },
        { name: 'old_string', type: 'string', description: 'exact text to replace', required: true },
        { name: 'new_string', type: 'string', description: 'replacement text', required: true },
        { name: 'replace_all', type: 'boolean', description: 'replace all occurrences (default false)', required: false }
      ],
      hitlAction: 'edit_file',
      execute: async args => {
        const path = str(args, 'path');
        const oldString = str(args, 'old_string');
        const newString = str(args, 'new_string');
        if (!oldString) throw new Error('single_find_and_replace: old_string is empty');
        const content = await readFileTool(path);
        const occurrences = content.split(oldString).length - 1;
        if (occurrences === 0) {
          throw new Error(`old_string not found in ${path} — re-read the file to copy the exact text`);
        }
        if (occurrences > 1 && !bool(args, 'replace_all')) {
          throw new Error(
            `old_string appears ${occurrences} times in ${path} — widen the context to make it unique or pass replace_all=true`
          );
        }
        const updated = bool(args, 'replace_all')
          ? content.split(oldString).join(newString)
          : content.replace(oldString, newString);
        await writeFileTool(path, updated);
        return `Replacement done in ${path} (${occurrences} occurrence${occurrences > 1 ? 's' : ''})`;
      }
    },
    {
      name: 'read_currently_open_file',
      description:
        'Reads the file currently open in the VS Code editor. Useful when the user refers to "this file" without giving a path.',
      parameters: [],
      hitlAction: 'read_file',
      execute: async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return '(no file open in the editor)';
        const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
        const text = editor.document.getText();
        const truncated = text.length > 20_000 ? text.slice(0, 20_000) + '\n… (truncated)' : text;
        return `Open file: ${relPath}\n\n${truncated}`;
      }
    },
    {
      name: 'grep_search',
      description:
        'Searches a regular expression across workspace files (max 50 results, format path:line: text)',
      parameters: [
        { name: 'pattern', type: 'string', description: 'regular expression (case-insensitive)', required: true },
        { name: 'glob', type: 'string', description: 'optional filter, e.g. src/**/*.ts', required: false }
      ],
      hitlAction: 'read_file',
      execute: async args => {
        const pattern = str(args, 'pattern');
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, 'i');
        } catch (err) {
          throw new Error(`Invalid regex: ${err instanceof Error ? err.message : err}`);
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
            continue; // file blocked by sandbox or unreadable
          }
          const lines = content.split('\n');
          for (let l = 0; l < lines.length && matches.length < 50; l++) {
            if (regex.test(lines[l])) {
              matches.push(`${file.path}:${l + 1}: ${lines[l].trim().slice(0, 200)}`);
            }
          }
        }
        return matches.join('\n') || '(no matches)';
      }
    },
    {
      name: 'ls',
      description: 'Lists files and folders in a workspace directory',
      parameters: [
        { name: 'path', type: 'string', description: 'relative path (default: root)', required: false }
      ],
      hitlAction: 'list_directory',
      execute: async args => {
        const items = await listDirectoryTool(str(args, 'path', '.'));
        return items.map(i => `${i.isDirectory ? '[dir] ' : ''}${i.path}`).join('\n') || '(empty)';
      }
    },
    {
      name: 'file_glob_search',
      description: 'Recursively searches files by simple glob pattern (* and **)',
      parameters: [
        { name: 'pattern', type: 'string', description: 'e.g. src/**/*.ts', required: true }
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
        return matches.join('\n') || '(no files found)';
      }
    },
    {
      name: 'run_terminal_command',
      description: 'Runs a shell command in the workspace (stdout/stderr captured, 30s timeout)',
      parameters: [
        { name: 'command', type: 'string', description: 'command to run', required: true }
      ],
      hitlAction: 'terminal',
      execute: async (args, signal) => {
        const result = await executeTerminalCommand(str(args, 'command'), { signal });
        const output = `${result.stdout}${result.stderr}`.trim();
        return [
          output || '(no output)',
          result.timedOut ? '[TIMEOUT]' : `[exit code: ${result.exitCode}]`
        ].join('\n');
      }
    },
    {
      name: 'run_in_background',
      description:
        'Starts a shell command in the background (dev server, watcher, long-running task) and returns its id immediately. Use check_background_process to read its output and stop_background_process to stop it — never Ctrl+C.',
      parameters: [
        { name: 'command', type: 'string', description: 'command to run in the background', required: true }
      ],
      hitlAction: 'terminal',
      execute: async args => {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
        const status = backgroundProcesses.start(str(args, 'command'), cwd);
        return `Background process started: id=${status.id}, pid=${status.pid ?? '?'} — ${status.command}`;
      }
    },
    {
      name: 'check_background_process',
      description: 'Status and recent output of a process started with run_in_background (no id: lists all processes)',
      parameters: [
        { name: 'id', type: 'string', description: 'id returned by run_in_background', required: false }
      ],
      hitlAction: 'read_file',
      execute: async args => {
        const id = str(args, 'id');
        if (!id) {
          const all = backgroundProcesses.list();
          if (all.length === 0) return '(no background processes)';
          return all
            .map(p => `${p.id} [${p.running ? 'running' : `exit ${p.exitCode}`}] ${p.command}`)
            .join('\n');
        }
        const status = backgroundProcesses.status(id);
        if (!status) return `Unknown process: ${id}`;
        return [
          `${status.id} [${status.running ? 'running' : `exit ${status.exitCode}`}] ${status.command}`,
          status.output.trim() || '(no output yet)'
        ].join('\n---\n');
      }
    },
    {
      name: 'stop_background_process',
      description: 'Stops a process started with run_in_background',
      parameters: [
        { name: 'id', type: 'string', description: 'id returned by run_in_background', required: true }
      ],
      hitlAction: 'terminal',
      execute: async args => {
        const id = str(args, 'id');
        return backgroundProcesses.stop(id)
          ? `Process ${id} stopped.`
          : `Process ${id} not found or already stopped.`;
      }
    },
    {
      name: 'view_diff',
      description: 'Shows the git diff of current changes',
      parameters: [],
      hitlAction: 'read_file',
      execute: async () => (await gitDiff()) || '(no changes)'
    },
    {
      name: 'git_status',
      description: 'Shows the git status of the workspace',
      parameters: [],
      hitlAction: 'read_file',
      execute: async () => (await gitStatus()) || '(clean working tree)'
    },
    {
      name: 'git_log',
      description: 'Shows recent commits',
      parameters: [
        { name: 'limit', type: 'number', description: 'number of commits (default 10)', required: false }
      ],
      hitlAction: 'read_file',
      execute: async args => gitLog(num(args, 'limit', 10))
    },
    {
      name: 'search_web',
      description: 'Web search for documentation or external knowledge',
      parameters: [
        { name: 'query', type: 'string', description: 'search query', required: true },
        {
          name: 'sites',
          type: 'array',
          description: 'domains to prefer (e.g. ["stackoverflow.com", "developer.mozilla.org"]), optional',
          required: false,
          jsonSchema: { type: 'array', items: { type: 'string' } }
        }
      ],
      hitlAction: 'web_search',
      execute: async args => webSearch(str(args, 'query'), { sites: strArray(args, 'sites') })
    },
    {
      name: 'update_todo_list',
      description:
        'Updates the task checklist displayed to the user above the chat. ' +
        'Replaces the full list on every call (no merging) — send all items each time, ' +
        'including those already marked "completed". Use it for multi-step tasks: ' +
        'call it again on every status change (set a task to "in_progress" just before ' +
        'starting it, then to "completed" right after finishing it) so progress is visible in real time.',
      parameters: [
        {
          name: 'items',
          type: 'array',
          description: 'full task list: [{id, content, status: "pending"|"in_progress"|"completed"}]',
          required: true,
          jsonSchema: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
              },
              required: ['content']
            }
          }
        }
      ],
      hitlAction: 'update_todo_list',
      execute: async args => {
        const items = sanitizeTodoItems(args.items);
        return `Checklist updated (${items.length} task(s)).`;
      }
    }
  ];
}

