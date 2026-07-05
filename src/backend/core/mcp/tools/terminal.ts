import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

export interface ExecuteOptions {
  cwd?: string;
  timeout?: number;
  onData?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

function getWorkspaceFolder(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Executes a shell command via child_process, capturing stdout/stderr.
 * Streams output through {@link ExecuteOptions.onData} if provided.
 */
export async function executeTerminalCommand(
  command: string,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const cwd = options.cwd ?? getWorkspaceFolder() ?? process.cwd();
  const timeout = options.timeout ?? 30000;
  const isWindows = process.platform === 'win32';

  return new Promise<ExecutionResult>(resolve => {
    const child = isWindows
      ? spawn('cmd.exe', ['/c', command], { cwd })
      : spawn('/bin/sh', ['-c', command], { cwd });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options.onData?.(text, 'stdout');
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options.onData?.(text, 'stderr');
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        stdout,
        stderr: stderr + `\n${err.message}`,
        exitCode: null,
        timedOut
      });
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({
        success: !timedOut && code === 0,
        stdout,
        stderr,
        exitCode: code,
        timedOut
      });
    });
  });
}
