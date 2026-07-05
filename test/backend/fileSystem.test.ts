import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readFileTool,
  writeFileTool,
  assertPathWithinWorkspace
} from '../../src/backend/core/mcp/tools/fileSystem.js';
import * as vscode from 'vscode';

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/test-workspace' } }]
  }
}));

describe('FileSystem Tools', () => {
  describe('assertPathWithinWorkspace', () => {
    it('should allow paths within workspace', () => {
      expect(() =>
        assertPathWithinWorkspace('/test-workspace', '/test-workspace/src/file.ts')
      ).not.toThrow();
    });

    it('should block path traversal', () => {
      expect(() =>
        assertPathWithinWorkspace('/test-workspace', '/etc/passwd')
      ).toThrow('Accès hors workspace interdit');
    });
  });

  describe('readFileTool', () => {
    it('should throw error if workspace not found', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue(undefined);
      await expect(readFileTool('test.txt')).rejects.toThrow('Workspace introuvable');
    });

    it('should prevent path traversal', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue([
        { uri: { fsPath: '/test-workspace' }, name: 'test', index: 0 }
      ]);
      await expect(readFileTool('../../../etc/passwd')).rejects.toThrow(/Accès refusé/);
    });
  });

  describe('writeFileTool', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should prevent path traversal', async () => {
      await expect(writeFileTool('../../../etc/passwd', 'test content'))
        .rejects
        .toThrow(/Accès refusé/);
    });

    it('should throw error if workspace not found', async () => {
      vi.spyOn(vscode.workspace, 'workspaceFolders', 'get').mockReturnValue(undefined);
      await expect(writeFileTool('test.txt', 'content')).rejects.toThrow('Workspace introuvable');
    });
  });
});
