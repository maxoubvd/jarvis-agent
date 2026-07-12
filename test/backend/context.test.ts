import { describe, it, expect } from 'vitest';
import { RagIndex, isIndexableFile, augmentWithCodeContext, type RagSearchResult } from '../../src/backend/services/context/rag.js';
import { pruneContext, choosePruneLevel, extractBlocks } from '../../src/backend/services/context/pruner.js';
import { expandMentions } from '../../src/backend/services/context/mentions.js';

describe('RagIndex (spec §5.2 — RAG local)', () => {
  it('finds the relevant chunk by lexical similarity', async () => {
    const index = new RagIndex();
    await index.addDocument('auth.ts', 'export function validatePassword(password: string) { return password.length > 8; }');
    await index.addDocument('math.ts', 'export function computeSum(a: number, b: number) { return a + b; }');

    const results = await index.search('validation du password');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('auth.ts');
  });

  it('splits camelCase identifiers for matching', async () => {
    const index = new RagIndex();
    await index.addDocument('a.ts', 'function fetchUserProfile() {}');
    const results = await index.search('user profile');
    expect(results[0]?.path).toBe('a.ts');
  });

  it('supports re-indexing and removal of documents', async () => {
    const index = new RagIndex();
    await index.addDocument('a.ts', 'const alpha = 1;');
    await index.addDocument('a.ts', 'const beta = 2;');
    // Re-indexing the same path replaces the existing chunk (no duplicate).
    expect(index.size).toBe(1);
    // Embedding similarity is continuous (no guaranteed "0 match" like with TF-IDF):
    // we check instead that the content was properly replaced — the new content's
    // term must score significantly higher than the old one's.
    const alphaScore = (await index.search('alpha'))[0]?.score ?? 0;
    const betaScore = (await index.search('beta'))[0]?.score ?? 0;
    expect(betaScore).toBeGreaterThan(alphaScore);

    index.removeDocument('a.ts');
    expect(index.size).toBe(0);
  });

  it('chunks long files with line ranges', async () => {
    const content = Array.from({ length: 100 }, (_, i) => `const line${i} = ${i};`).join('\n');
    const index = new RagIndex();
    await index.addDocument('big.ts', content);
    expect(index.size).toBeGreaterThan(1);
    const results = await index.search('line99');
    expect(results[0].endLine).toBe(100);
  });

  it('filters indexable files by extension', () => {
    expect(isIndexableFile('src/app.ts')).toBe(true);
    expect(isIndexableFile('doc/readme.md')).toBe(true);
    expect(isIndexableFile('image.png')).toBe(false);
    expect(isIndexableFile('binaire')).toBe(false);
  });
});

describe('augmentWithCodeContext (spec §5.2 — context augmentation)', () => {
  const result = (score: number, path = 'auth.ts'): RagSearchResult => ({
    path,
    startLine: 1,
    endLine: 5,
    snippet: 'export function validatePassword() { /* ... */ }',
    score
  });

  it('appends relevant snippets to the task under a labeled context block', () => {
    const task = 'Add password validation';
    const augmented = augmentWithCodeContext(task, [result(0.55)]);
    expect(augmented).toContain(task);
    expect(augmented).toContain('--- PROJECT CONTEXT (automatic search) ---');
    expect(augmented).toContain('auth.ts (lines 1-5)');
  });

  it('returns the task unchanged when no result clears the noise floor', () => {
    const task = 'Add password validation';
    const augmented = augmentWithCodeContext(task, [result(0.05), result(-0.02)]);
    expect(augmented).toBe(task);
  });

  it('returns the task unchanged for an empty result set', () => {
    const task = 'Add password validation';
    expect(augmentWithCodeContext(task, [])).toBe(task);
  });

  it('only includes results above the noise floor, not the weak ones', () => {
    const task = 'Add password validation';
    const augmented = augmentWithCodeContext(task, [result(0.5, 'auth.ts'), result(0.05, 'unrelated.ts')]);
    expect(augmented).toContain('auth.ts');
    expect(augmented).not.toContain('unrelated.ts');
  });
});

describe('ContextPruner (spec §8.3)', () => {
  const sample = [
    "import { x } from './x';",
    '',
    'export function keepMe(a: number) {',
    '  return a * 2;',
    '}',
    '',
    'export function dropMe() {',
    '  return 42;',
    '}'
  ].join('\n');

  it('extracts function blocks', () => {
    const blocks = extractBlocks(sample);
    expect(blocks.map(b => b.name)).toEqual(['keepMe', 'dropMe']);
  });

  it('keeps imports + target function, reduces the rest to signatures', async () => {
    const pruned = await pruneContext(sample, { level: 'function', symbol: 'keepMe' });
    expect(pruned).toContain("import { x } from './x';");
    expect(pruned).toContain('return a * 2;');
    expect(pruned).not.toContain('return 42;');
    expect(pruned).toContain('dropMe');
  });

  it('uses the Tree-sitter AST path, not the naive-brace regex fallback', async () => {
    // A brace inside a string would break the naive brace counter of the regex fallback
    // (premature block end); the Tree-sitter AST does not make this mistake.
    const tricky = [
      'export function tricky() {',
      '  const s = "a } b";',
      '  return s;',
      '}',
      '',
      'export function after() {',
      '  return 1;',
      '}'
    ].join('\n');
    const pruned = await pruneContext(tricky, { level: 'function', symbol: 'tricky', fileExtension: '.ts' });
    expect(pruned).toContain('return s;');
    expect(pruned).toContain('}');
  });

  it('level none returns full content', async () => {
    expect(await pruneContext(sample, { level: 'none' })).toBe(sample);
  });

  it('level module strips comments and blank lines', async () => {
    const withComments = '// comment\nconst a = 1;\n\n// other\nconst b = 2;';
    const pruned = await pruneContext(withComments, { level: 'module' });
    expect(pruned).toBe('const a = 1;\nconst b = 2;');
  });

  it('handles Python-style indentation blocks', () => {
    const py = 'def foo():\n    return 1\n\ndef bar():\n    return 2';
    const blocks = extractBlocks(py);
    expect(blocks.map(b => b.name)).toEqual(['foo', 'bar']);
    expect(blocks[0].endLine).toBe(1);
  });

  it('chooses stricter levels as content grows', () => {
    expect(choosePruneLevel(100, 1000)).toBe('none');
    expect(choosePruneLevel(4 * 400, 1000)).toBe('module');
    expect(choosePruneLevel(4 * 900, 1000)).toBe('class');
    expect(choosePruneLevel(4 * 5000, 1000)).toBe('function');
  });
});

describe('Mentions @file / @docs (spec Phase 4)', () => {
  it('injects file content into the prompt', async () => {
    const result = await expandMentions('Explique @file:src/a.ts', {
      readFile: async p => `contenu de ${p}`
    });
    expect(result.expanded).toContain('contenu de src/a.ts');
    expect(result.mentions).toEqual([{ kind: 'file', value: 'src/a.ts', ok: true }]);
  });

  it('reports unreadable files without failing', async () => {
    const result = await expandMentions('Read @file:.env', {
      readFile: async () => {
        throw new Error('Access denied');
      }
    });
    expect(result.mentions[0].ok).toBe(false);
    expect(result.expanded).toContain('Access denied');
  });

  it('injects docs search results', async () => {
    const result = await expandMentions('How to configure? @docs:configuration', {
      readFile: async () => '',
      searchDocs: async () => [
        { path: 'README.md', startLine: 1, endLine: 10, snippet: 'Configuration is done via jarvis-config.json', score: 0.9 }
      ]
    });
    expect(result.expanded).toContain('jarvis-config.json');
    expect(result.mentions[0]).toEqual({ kind: 'docs', value: 'configuration', ok: true });
  });

  it('returns the prompt unchanged without mentions', async () => {
    const result = await expandMentions('hello', { readFile: async () => '' });
    expect(result.expanded).toBe('hello');
    expect(result.mentions).toHaveLength(0);
  });

  it('supports quoted paths with spaces (@file:"...")', async () => {
    const result = await expandMentions('Explain @file:"my folder/read me.md"', {
      readFile: async p => `content of ${p}`
    });
    expect(result.expanded).toContain('content of my folder/read me.md');
    expect(result.mentions).toEqual([{ kind: 'file', value: 'my folder/read me.md', ok: true }]);
  });

  it('supports quoted docs queries with spaces (@docs:"...")', async () => {
    const result = await expandMentions('How to do it? @docs:"hitl config"', {
      readFile: async () => '',
      searchDocs: async () => [
        { path: 'README.md', startLine: 1, endLine: 5, snippet: 'HITL is configured via jarvis.hitl.mode', score: 0.8 }
      ]
    });
    expect(result.expanded).toContain('jarvis.hitl.mode');
    expect(result.mentions).toEqual([{ kind: 'docs', value: 'hitl config', ok: true }]);
  });
});
