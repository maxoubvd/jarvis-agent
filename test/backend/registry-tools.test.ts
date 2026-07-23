import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** In-memory file system injected into tool-registry via fileSystem module mock. */
const files = vi.hoisted(() => new Map<string, string>());

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test-workspace' } }],
    asRelativePath: () => 'src/open-file.ts'
  },
  window: { activeTextEditor: undefined as unknown }
}));

vi.mock('../../packages/core/src/core/mcp/tools/fileSystem.js', () => ({
  readFileTool: vi.fn(async (p: string) => {
    if (!files.has(p)) throw new Error(`Fichier introuvable: ${p}`);
    return files.get(p)!;
  }),
  writeFileTool: vi.fn(async (p: string, c: string) => {
    files.set(p, c);
  }),
  editFileTool: vi.fn(),
  deleteFileTool: vi.fn(),
  listDirectoryTool: vi.fn(async () =>
    [...files.keys()].map(p => ({ name: p, path: p, isDirectory: false, size: 100 }))
  ),
  setSandbox: vi.fn(),
  setFileChangeListener: vi.fn()
}));

import { createBuiltinTools, ToolRegistry, setActiveFileProvider, type ToolDefinition } from '../../packages/core/src/core/agent/tool-registry.js';

function tool(name: string): ToolDefinition {
  const found = createBuiltinTools().find(t => t.name === name);
  if (!found) throw new Error(`tool not found in registry: ${name}`);
  return found;
}

beforeEach(() => {
  files.clear();
});

describe('single_find_and_replace', () => {
  it('replaces a unique occurrence', async () => {
    files.set('a.ts', 'const x = 1;\nconst y = 2;');
    const result = await tool('single_find_and_replace').execute({
      path: 'a.ts',
      old_string: 'const x = 1;',
      new_string: 'const x = 42;'
    });
    expect(result).toContain('Replacement done');
    expect(files.get('a.ts')).toBe('const x = 42;\nconst y = 2;');
  });

  it('fails when old_string is missing or ambiguous', async () => {
    files.set('a.ts', 'foo\nfoo');
    await expect(
      tool('single_find_and_replace').execute({ path: 'a.ts', old_string: 'bar', new_string: 'x' })
    ).rejects.toThrow(/not found/);
    await expect(
      tool('single_find_and_replace').execute({ path: 'a.ts', old_string: 'foo', new_string: 'x' })
    ).rejects.toThrow(/2 times/);
  });

  it('replace_all replaces every occurrence', async () => {
    files.set('a.ts', 'foo foo foo');
    await tool('single_find_and_replace').execute({
      path: 'a.ts',
      old_string: 'foo',
      new_string: 'bar',
      replace_all: true
    });
    expect(files.get('a.ts')).toBe('bar bar bar');
  });
});

describe('grep_search', () => {
  it('returns path:line matches with an optional glob filter', async () => {
    files.set('src/app.ts', 'const token = 1;\nconsole.log(token);');
    files.set('docs/readme.md', 'token in docs');

    const all = await tool('grep_search').execute({ pattern: 'token' });
    expect(all).toContain('src/app.ts:1:');
    expect(all).toContain('docs/readme.md:1:');

    const filtered = await tool('grep_search').execute({ pattern: 'token', glob: 'src/**/*.ts' });
    expect(filtered).toContain('src/app.ts:1:');
    expect(filtered).not.toContain('readme.md');
  });

  it('rejects invalid regexes and reports empty results', async () => {
    await expect(tool('grep_search').execute({ pattern: '([' })).rejects.toThrow(/Invalid regex/);
    expect(await tool('grep_search').execute({ pattern: 'nothing' })).toBe('(no matches)');
  });
});

describe('ToolRegistry.restrictTo', () => {
  function fakeTool(name: string, origin?: 'builtin' | 'custom' | 'mcp'): ToolDefinition {
    return { name, description: '', parameters: [], hitlAction: 'read_file', origin, execute: async () => '' };
  }

  it('removes non-matching builtin tools but keeps allowed ones', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool('read_file', 'builtin'));
    registry.register(fakeTool('edit_existing_file', 'builtin'));
    registry.restrictTo(['read_file']);
    expect(registry.get('read_file')).toBeDefined();
    expect(registry.get('edit_existing_file')).toBeUndefined();
  });

  it('never removes mcp or custom tools regardless of the prefix list', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool('read_file', 'builtin'));
    registry.register(fakeTool('mcp__playwright__run_tests', 'mcp'));
    registry.register(fakeTool('my_custom_tool', 'custom'));
    registry.restrictTo(['read_file']);
    expect(registry.get('mcp__playwright__run_tests')).toBeDefined();
    expect(registry.get('my_custom_tool')).toBeDefined();
    expect(registry.get('read_file')).toBeDefined();
  });

  it('treats tools without an origin as builtin (back-compat)', () => {
    const registry = new ToolRegistry();
    registry.register(fakeTool('read_file'));
    registry.register(fakeTool('edit_existing_file'));
    registry.restrictTo(['read_file']);
    expect(registry.get('read_file')).toBeDefined();
    expect(registry.get('edit_existing_file')).toBeUndefined();
  });
});

describe('read_currently_open_file', () => {
  // The "currently open file" is host-injected (setActiveFileProvider): the VS Code
  // extension backs it with the active editor, the CLI with the last @file opened.
  afterEach(() => setActiveFileProvider(null));

  it('reads the active file from the injected provider', async () => {
    setActiveFileProvider(() => ({ path: 'src/open-file.ts', content: 'contenu ouvert' }));
    const result = await tool('read_currently_open_file').execute({});
    expect(result).toContain('src/open-file.ts');
    expect(result).toContain('contenu ouvert');
  });

  it('reports when no file is open (no provider / provider returns undefined)', async () => {
    setActiveFileProvider(() => undefined);
    expect(await tool('read_currently_open_file').execute({})).toContain('no file open in the editor');
  });
});
