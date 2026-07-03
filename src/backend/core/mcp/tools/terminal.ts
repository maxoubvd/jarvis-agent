import * as vscode from 'vscode';

export async function executeTerminalCommand(command: string): Promise<void> {
  const terminal = vscode.window.createTerminal({ name: 'Jarvis Terminal' });
  terminal.sendText(command);
  terminal.show(true);
}
