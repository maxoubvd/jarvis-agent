import { executeTerminalCommand, ExecutionResult } from './terminal.js';

export async function gitStatus(): Promise<string> {
  return runGit('git status --short');
}

export async function gitDiff(): Promise<string> {
  return runGit('git diff');
}

export async function gitLog(limit = 10): Promise<string> {
  return runGit(`git log --oneline -n ${limit}`);
}

async function runGit(command: string): Promise<string> {
  const result: ExecutionResult = await executeTerminalCommand(command);
  if (!result.success) {
    throw new Error(result.stderr || `Git command failed: ${command}`);
  }
  return result.stdout;
}
