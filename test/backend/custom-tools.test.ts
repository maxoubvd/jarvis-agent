import { describe, it, expect, vi } from 'vitest';
import { specToTool, CustomToolSpec } from '../../src/backend/core/agent/custom-tools.js';
import { globToRegex } from '../../src/backend/core/agent/tool-registry.js';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test-workspace' } }]
  }
}));

vi.mock('../../src/backend/core/mcp/tools/terminal.js', () => ({
  executeTerminalCommand: vi.fn(async (command: string) => ({
    success: true,
    stdout: `ran: ${command}`,
    stderr: '',
    exitCode: 0,
    timedOut: false
  }))
}));

describe('Custom Tools (spec §5.1)', () => {
  const spec: CustomToolSpec = {
    name: 'count_lines',
    description: 'Compte les lignes',
    parameters: [{ name: 'file', type: 'string', description: 'chemin', required: true }],
    command: 'wc -l {file}'
  };

  it('converts a JSON spec into an executable tool', async () => {
    const tool = specToTool(spec);
    expect(tool.name).toBe('count_lines');
    expect(tool.hitlAction).toBe('terminal');
    const output = await tool.execute({ file: 'src/a.ts' });
    expect(output).toContain('ran: wc -l src/a.ts');
  });

  it('sanitizes shell metacharacters in arguments', async () => {
    const tool = specToTool(spec);
    const output = await tool.execute({ file: 'a.ts; rm -rf /' });
    expect(output).not.toContain(';');
    expect(output).toContain('rm -rf /'.replace(';', ''));
  });
});

describe('globToRegex', () => {
  it('matches ** recursively and * within a segment', () => {
    const regex = globToRegex('src/**/*.ts');
    expect(regex.test('src/a.ts')).toBe(true);
    expect(regex.test('src/deep/nested/b.ts')).toBe(true);
    expect(regex.test('lib/a.ts')).toBe(false);
    expect(regex.test('src/a.js')).toBe(false);
  });
});
