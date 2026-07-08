import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Système de fichiers en mémoire injecté dans tool-registry via le mock du module fileSystem. */
const files = vi.hoisted(() => new Map<string, string>());

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test-workspace' } }],
    asRelativePath: () => 'src/open-file.ts'
  },
  window: { activeTextEditor: undefined as unknown }
}));

vi.mock('../../src/backend/core/mcp/tools/fileSystem.js', () => ({
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

import * as vscode from 'vscode';
import { createBuiltinTools, type ToolDefinition } from '../../src/backend/core/agent/tool-registry.js';

function tool(name: string): ToolDefinition {
  const found = createBuiltinTools().find(t => t.name === name);
  if (!found) throw new Error(`outil absent du registre: ${name}`);
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
    expect(result).toContain('Remplacement effectué');
    expect(files.get('a.ts')).toBe('const x = 42;\nconst y = 2;');
  });

  it('fails when old_string is missing or ambiguous', async () => {
    files.set('a.ts', 'foo\nfoo');
    await expect(
      tool('single_find_and_replace').execute({ path: 'a.ts', old_string: 'bar', new_string: 'x' })
    ).rejects.toThrow(/introuvable/);
    await expect(
      tool('single_find_and_replace').execute({ path: 'a.ts', old_string: 'foo', new_string: 'x' })
    ).rejects.toThrow(/2 fois/);
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
    await expect(tool('grep_search').execute({ pattern: '([' })).rejects.toThrow(/Regex invalide/);
    expect(await tool('grep_search').execute({ pattern: 'nothing' })).toBe('(aucune correspondance)');
  });
});

describe('read_currently_open_file', () => {
  it('reads the active editor content', async () => {
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
      document: { uri: {}, getText: () => 'contenu ouvert' }
    };
    const result = await tool('read_currently_open_file').execute({});
    expect(result).toContain('src/open-file.ts');
    expect(result).toContain('contenu ouvert');
  });

  it('reports when no editor is open', async () => {
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
    expect(await tool('read_currently_open_file').execute({})).toContain('aucun fichier ouvert');
  });
});
