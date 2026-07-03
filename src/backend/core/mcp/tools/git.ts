import * as vscode from 'vscode';

export async function gitStatus(): Promise<void> {
  await executeGitCommand('git status --short');
}

async function executeGitCommand(command: string): Promise<void> {
  const terminal = vscode.window.createTerminal({ name: 'Jarvis Git' });
  terminal.sendText(command);
  terminal.show(true);
}
