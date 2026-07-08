import { describe, it, expect, vi } from 'vitest';
import { SandboxManager } from '../../src/backend/core/utils/sandbox.js';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: 'c:\\test-workspace' } }]
  }
}));

describe('SandboxManager', () => {
  it('allows access to files within the workspace root', () => {
    const sandbox = new SandboxManager('c:\\test-workspace');
    expect(sandbox.canAccess('c:\\test-workspace\\src\\file.ts').allowed).toBe(true);
  });

  it('blocks access to files outside the workspace root', () => {
    const sandbox = new SandboxManager('c:\\test-workspace');
    expect(sandbox.canAccess('c:\\other-dir\\file.ts').allowed).toBe(false);
  });

  it('handles case-insensitivity on Windows drive letters', () => {
    // Under Windows platform or simulated Windows paths
    const sandbox = new SandboxManager('c:\\test-workspace');
    // Using uppercase drive letter for target path
    const result = sandbox.canAccess('C:\\test-workspace\\src\\file.ts');
    expect(result.allowed).toBe(true);
  });
});
