import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolDefinition, ToolParameter } from './tool-registry.js';
import { executeTerminalCommand } from '../mcp/tools/terminal.js';

/**
 * Custom tool defined in JSON under `jarvis-tools/*.json` (spec §5.1):
 * {
 *   "name": "count_lines",
 *   "description": "Counts the lines of a file",
 *   "parameters": [{ "name": "file", "type": "string", "description": "path", "required": true }],
 *   "command": "wc -l {file}"
 * }
 * The `{param}` placeholder is replaced by the argument's value.
 */
export interface CustomToolSpec {
  name: string;
  description: string;
  parameters?: ToolParameter[];
  command: string;
  timeout?: number;
}

function isValidSpec(spec: unknown): spec is CustomToolSpec {
  if (!spec || typeof spec !== 'object') return false;
  const s = spec as Record<string, unknown>;
  return (
    typeof s.name === 'string' &&
    /^[a-zA-Z0-9_-]+$/.test(s.name) &&
    typeof s.description === 'string' &&
    typeof s.command === 'string'
  );
}

/** Escapes the value for interpolation into a shell command. */
function sanitizeArgValue(value: unknown): string {
  return String(value).replace(/[;&|`$<>\r\n]/g, '');
}

export function specToTool(spec: CustomToolSpec): ToolDefinition {
  return {
    name: spec.name,
    description: `${spec.description} (custom tool)`,
    parameters: spec.parameters ?? [],
    // Custom tools execute shell commands → always subject to terminal HITL.
    hitlAction: 'terminal',
    execute: async args => {
      let command = spec.command;
      for (const param of spec.parameters ?? []) {
        const value = sanitizeArgValue(args[param.name] ?? '');
        command = command.split(`{${param.name}}`).join(value);
      }
      const result = await executeTerminalCommand(command, { timeout: spec.timeout ?? 30000 });
      const output = `${result.stdout}${result.stderr}`.trim();
      return [output || '(no output)', result.timedOut ? '[TIMEOUT]' : `[exit code: ${result.exitCode}]`].join('\n');
    }
  };
}

/** Loads all JSON tools from `<workspace>/jarvis-tools/`. */
export async function loadCustomTools(workspaceRoot: string): Promise<ToolDefinition[]> {
  const toolsDir = path.join(workspaceRoot, 'jarvis-tools');
  let entries: string[];
  try {
    entries = await fs.readdir(toolsDir);
  } catch {
    return [];
  }

  const tools: ToolDefinition[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = await fs.readFile(path.join(toolsDir, entry), 'utf-8');
      const spec = JSON.parse(raw) as unknown;
      if (isValidSpec(spec)) {
        tools.push(specToTool(spec));
      } else {
        console.warn(`Jarvis: invalid custom tool ignored: ${entry}`);
      }
    } catch (err) {
      console.warn(`Jarvis: failed to load tool ${entry}:`, err);
    }
  }
  return tools;
}
