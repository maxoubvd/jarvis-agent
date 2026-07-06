import * as vscode from 'vscode';

export type HITLMode = 'strict' | 'moderate' | 'free';

export interface ApprovalResult {
  granted: boolean;
  reason: string;
  sessionAllowed?: boolean;
}

const DANGEROUS_PATTERNS = [
  'rm -rf', 'rm -r', 'del /f', 'rmdir /s',
  'git push', 'git reset --hard', 'git clean',
  'npm install --global', 'npm install -g',
  'chmod 777', 'sudo ',
  'DROP TABLE', 'DELETE FROM', 'TRUNCATE'
];

const SAFE_PATTERNS = [
  'ls', 'dir', 'pwd', 'echo', 'cat ', 'type ',
  'git status', 'git diff', 'git log',
  'npm test', 'npm run test', 'npx vitest',
  'node --version', 'npm --version'
];

export class HITLManager {
  private mode: HITLMode;
  private sessionAllowances = new Set<string>();

  constructor(mode: HITLMode = 'moderate') {
    this.mode = mode;
  }

  public setMode(mode: HITLMode): void {
    this.mode = mode;
  }

  public getMode(): HITLMode {
    return this.mode;
  }

  public async checkApproval(actionType: string, params: Record<string, unknown>): Promise<ApprovalResult> {
    if (this.mode === 'free') {
      return { granted: true, reason: 'Mode libre activé' };
    }

    const actionKey = this.getActionKey(actionType, params);

    if (this.sessionAllowances.has(actionKey)) {
      return { granted: true, reason: 'Autorisé pour cette session', sessionAllowed: true };
    }

    const isSafe = this.isSafeAction(actionType, params);
    const isDangerous = this.isDangerousAction(actionType, params);

    if (this.mode === 'moderate') {
      if (isSafe) {
        return { granted: true, reason: 'Action sûre — approuvée automatiquement' };
      }
      if (!isDangerous) {
        return { granted: true, reason: 'Mode modéré — action approuvée' };
      }
    }

    return await this.promptUser(actionType, params, actionKey);
  }

  private isSafeAction(actionType: string, params: Record<string, unknown>): boolean {
    if (actionType === 'read_file' || actionType === 'list_directory') {
      return true;
    }
    if (actionType === 'terminal') {
      const command = String(params.command ?? '');
      return SAFE_PATTERNS.some(p => command.startsWith(p) || command === p.trim());
    }
    return false;
  }

  private isDangerousAction(actionType: string, params: Record<string, unknown>): boolean {
    if (actionType === 'delete_file') return true;
    if (actionType === 'terminal') {
      const command = String(params.command ?? '').toLowerCase();
      return DANGEROUS_PATTERNS.some(p => command.includes(p.toLowerCase()));
    }
    if (actionType === 'write_file' || actionType === 'edit_file') {
      const filePath = String(params.path ?? '');
      return filePath.includes('.env') || filePath.includes('package.json') || filePath.includes('tsconfig');
    }
    return false;
  }

  private getActionKey(actionType: string, params: Record<string, unknown>): string {
    if (actionType === 'terminal') return `terminal:${params.command}`;
    if (actionType === 'write_file' || actionType === 'edit_file' || actionType === 'delete_file') {
      return `${actionType}:${params.path}`;
    }
    return actionType;
  }

  private async promptUser(
    actionType: string,
    params: Record<string, unknown>,
    actionKey: string
  ): Promise<ApprovalResult> {
    const description = this.describeAction(actionType, params);
    const detail = Object.entries(params)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    const result = await vscode.window.showInformationMessage(
      `Jarvis souhaite effectuer : ${description}`,
      { modal: true, detail },
      'Autoriser',
      'Autoriser pour la session',
      'Refuser'
    );

    if (result === 'Autoriser') {
      return { granted: true, reason: 'Approuvé par l\'utilisateur' };
    }

    if (result === 'Autoriser pour la session') {
      this.sessionAllowances.add(actionKey);
      return { granted: true, reason: 'Approuvé pour la session', sessionAllowed: true };
    }

    return { granted: false, reason: 'Refusé par l\'utilisateur' };
  }

  private describeAction(actionType: string, params: Record<string, unknown>): string {
    switch (actionType) {
      case 'terminal': return `Exécuter: ${params.command}`;
      case 'write_file': return `Écrire dans: ${params.path}`;
      case 'edit_file': return `Modifier: ${params.path}`;
      case 'delete_file': return `Supprimer: ${params.path}`;
      case 'read_file': return `Lire: ${params.path}`;
      case 'web_search': return `Rechercher: ${params.query}`;
      case 'mcp': return `Appeler l'outil MCP: ${params.tool ?? '?'} (serveur: ${params.server ?? '?'})`;
      default: return actionType;
    }
  }
}
