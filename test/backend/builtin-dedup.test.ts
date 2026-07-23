import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: { workspaceFolders: undefined },
  window: { activeTextEditor: undefined }
}));

import {
  BUILTIN_MCP_EQUIVALENTS,
  isBuiltinShadowed,
  type ActiveMcpTools
} from '../../packages/core/src/core/agent/builtin-dedup.js';
import { createBuiltinTools } from '../../packages/core/src/core/agent/tool-registry.js';

function active(entries: Record<string, string[]>): ActiveMcpTools {
  return new Map(Object.entries(entries).map(([server, tools]) => [server, new Set(tools)]));
}

describe('builtin-dedup (Settings > Agent tools vs serveurs MCP)', () => {
  it('shadows file builtins when the filesystem server exposes an equivalent', () => {
    const fs = active({ filesystem: ['read_text_file', 'write_file', 'edit_file', 'list_directory', 'search_files'] });
    expect(isBuiltinShadowed('read_file', fs)).toBe(true);
    expect(isBuiltinShadowed('create_new_file', fs)).toBe(true);
    expect(isBuiltinShadowed('edit_existing_file', fs)).toBe(true);
    expect(isBuiltinShadowed('ls', fs)).toBe(true);
    expect(isBuiltinShadowed('file_glob_search', fs)).toBe(true);
  });

  it('accepts the legacy read_file name of older filesystem servers', () => {
    expect(isBuiltinShadowed('read_file', active({ filesystem: ['read_file'] }))).toBe(true);
  });

  it('shadows git builtins when the git server is connected', () => {
    const git = active({ git: ['git_status', 'git_log', 'git_diff_unstaged'] });
    expect(isBuiltinShadowed('git_status', git)).toBe(true);
    expect(isBuiltinShadowed('git_log', git)).toBe(true);
    expect(isBuiltinShadowed('view_diff', git)).toBe(true);
  });

  it('keeps builtins when the server is absent or the equivalent tool inactive', () => {
    expect(isBuiltinShadowed('read_file', new Map())).toBe(false);
    expect(isBuiltinShadowed('read_file', active({ git: ['git_status'] }))).toBe(false);
    // Equivalent tool excluded (absent from set) → builtin kept.
    expect(isBuiltinShadowed('read_file', active({ filesystem: ['write_file'] }))).toBe(false);
    expect(isBuiltinShadowed('git_status', active({ filesystem: ['read_text_file'] }))).toBe(false);
  });

  it('never shadows builtins without an MCP equivalent', () => {
    const everything = active({
      filesystem: ['read_text_file', 'write_file', 'edit_file', 'list_directory', 'search_files'],
      git: ['git_status', 'git_log', 'git_diff_unstaged']
    });
    for (const name of [
      'single_find_and_replace',
      'read_currently_open_file',
      'grep_search',
      'run_terminal_command',
      'run_in_background',
      'check_background_process',
      'stop_background_process',
      'search_web'
    ]) {
      expect(isBuiltinShadowed(name, everything), name).toBe(false);
    }
  });

  it('every mapping key matches an existing builtin tool (anti-drift)', () => {
    const builtinNames = new Set(createBuiltinTools().map(t => t.name));
    for (const key of Object.keys(BUILTIN_MCP_EQUIVALENTS)) {
      expect(builtinNames.has(key), `mapping key ${key} has no builtin`).toBe(true);
    }
  });
});
