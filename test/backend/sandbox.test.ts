import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

  describe('reloadIgnorePatterns', () => {
    let workspaceDir: string;

    afterEach(() => {
      if (workspaceDir) fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    it('picks up a pattern added by hand-editing .jarvisignore after construction', () => {
      workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sandbox-'));
      fs.writeFileSync(path.join(workspaceDir, '.jarvisignore'), '# comment\n', 'utf-8');

      const sandbox = new SandboxManager(workspaceDir);
      const target = path.join(workspaceDir, 'spec.md');

      // Not ignored yet — the file only has a comment.
      expect(sandbox.canAccess(target).allowed).toBe(true);

      // Simulate the user manually adding a line in their editor, bypassing
      // addIgnorePattern()/setSandbox() entirely.
      fs.appendFileSync(path.join(workspaceDir, '.jarvisignore'), 'spec.md\n', 'utf-8');

      // Without a reload, the in-memory patterns are stale (this is the bug:
      // nothing previously called reloadIgnorePatterns() on manual edits).
      expect(sandbox.canAccess(target).allowed).toBe(true);

      return sandbox.reloadIgnorePatterns().then(() => {
        expect(sandbox.canAccess(target).allowed).toBe(false);
      });
    });
  });
});
