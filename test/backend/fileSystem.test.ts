import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readFileTool,
  writeFileTool,
  assertPathWithinWorkspace
} from '../../packages/core/src/core/mcp/tools/fileSystem.js';

// The core is host-agnostic: the workspace root comes from JARVIS_WORKSPACE
// (the VS Code extension seeds it at activation; the CLI relies on process.cwd()).
// There is no longer a "workspace not found" state — a root always resolves.

describe('FileSystem Tools', () => {
  beforeEach(() => {
    process.env.JARVIS_WORKSPACE = '/test-workspace';
  });
  afterEach(() => {
    delete process.env.JARVIS_WORKSPACE;
  });

  describe('assertPathWithinWorkspace', () => {
    it('should allow paths within workspace', () => {
      expect(() =>
        assertPathWithinWorkspace('/test-workspace', '/test-workspace/src/file.ts')
      ).not.toThrow();
    });

    it('should block path traversal', () => {
      expect(() =>
        assertPathWithinWorkspace('/test-workspace', '/etc/passwd')
      ).toThrow('Access outside workspace is forbidden');
    });
  });

  describe('readFileTool', () => {
    it('resolves paths against the JARVIS_WORKSPACE root and blocks traversal', async () => {
      await expect(readFileTool('../../../etc/passwd')).rejects.toThrow(/Access denied/);
    });
  });

  describe('writeFileTool', () => {
    it('resolves paths against the JARVIS_WORKSPACE root and blocks traversal', async () => {
      await expect(writeFileTool('../../../etc/passwd', 'test content'))
        .rejects
        .toThrow(/Access denied/);
    });
  });
});
