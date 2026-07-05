import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { SandboxManager } from '../../utils/sandbox.js';

let sandbox: SandboxManager | null = null;

function getSandbox(): SandboxManager {
  if (!sandbox) {
    sandbox = new SandboxManager();
  }
  return sandbox;
}

/** Allows tests / callers to inject a sandbox or reset it after workspace change. */
export function setSandbox(manager: SandboxManager | null): void {
  sandbox = manager;
}

function getWorkspaceFolder(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) {
    throw new Error('Workspace introuvable');
  }
  return workspaceFolder;
}

function resolveWorkspacePath(workspaceFolder: string, filePath: string): string {
  return path.resolve(workspaceFolder, filePath);
}

/**
 * Legacy lightweight guard kept for backward compatibility with existing tests.
 * New code should rely on {@link SandboxManager} via {@link assertCanAccess}.
 */
export function assertPathWithinWorkspace(workspaceFolder: string, targetPath: string): void {
  const normalizedWorkspace = path.resolve(workspaceFolder);
  const normalizedTarget = path.resolve(targetPath);
  const relative = path.relative(normalizedWorkspace, normalizedTarget);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Accès hors workspace interdit');
  }
}

function assertCanAccess(resolvedPath: string): void {
  const result = getSandbox().canAccess(resolvedPath);
  if (!result.allowed) {
    throw new Error(`Accès refusé : ${result.reason}`);
  }
}

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
}

export async function readFileTool(filePath: string): Promise<string> {
  const workspaceFolder = getWorkspaceFolder();
  const resolvedPath = resolveWorkspacePath(workspaceFolder, filePath);
  assertCanAccess(resolvedPath);
  return await fs.readFile(resolvedPath, 'utf-8');
}

export async function writeFileTool(filePath: string, content: string): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  const resolvedPath = resolveWorkspacePath(workspaceFolder, filePath);
  assertCanAccess(resolvedPath);

  const dirPath = path.dirname(resolvedPath);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(resolvedPath, content, 'utf-8');
}

/**
 * Replaces lines [startLine, endLine] (1-indexed, inclusive) with newText.
 * If endLine is omitted, only startLine is replaced.
 */
export async function editFileTool(
  filePath: string,
  startLine: number,
  endLine: number,
  newText: string
): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  const resolvedPath = resolveWorkspacePath(workspaceFolder, filePath);
  assertCanAccess(resolvedPath);

  const original = await fs.readFile(resolvedPath, 'utf-8');
  const lines = original.split('\n');

  const start = Math.max(1, startLine);
  const end = Math.min(lines.length, endLine || startLine);

  if (start > lines.length) {
    throw new Error(`edit_file : ligne de départ ${start} hors limites (fichier: ${lines.length} lignes)`);
  }

  const newLines = newText.split('\n');
  lines.splice(start - 1, end - start + 1, ...newLines);

  await fs.writeFile(resolvedPath, lines.join('\n'), 'utf-8');
}

export async function listDirectoryTool(dirPath: string, recursive = false): Promise<FileItem[]> {
  const workspaceFolder = getWorkspaceFolder();
  const resolvedPath = resolveWorkspacePath(workspaceFolder, dirPath);
  assertCanAccess(resolvedPath);

  const items: FileItem[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      // Silently skip anything the sandbox blocks (node_modules, .env, etc.)
      if (!getSandbox().canAccess(fullPath).allowed) continue;

      let size = 0;
      try {
        const stat = await fs.stat(fullPath);
        size = stat.size;
      } catch {
        // ignore stat errors
      }

      items.push({
        name: entry.name,
        path: path.relative(workspaceFolder, fullPath).replace(/\\/g, '/'),
        isDirectory: entry.isDirectory(),
        size
      });

      if (recursive && entry.isDirectory()) {
        await walk(fullPath);
      }
    }
  }

  await walk(resolvedPath);
  return items;
}

export async function deleteFileTool(filePath: string): Promise<void> {
  const workspaceFolder = getWorkspaceFolder();
  const resolvedPath = resolveWorkspacePath(workspaceFolder, filePath);
  assertCanAccess(resolvedPath);
  await fs.rm(resolvedPath, { recursive: true, force: true });
}
