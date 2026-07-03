import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export async function readFileTool(filePath: string): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) throw new Error('Workspace introuvable');

  const resolvedPath = path.resolve(workspaceFolder, filePath);
  return await fs.readFile(resolvedPath, 'utf-8');
}
