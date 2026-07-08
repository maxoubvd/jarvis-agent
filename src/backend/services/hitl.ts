import * as vscode from 'vscode';

export type HITLMode = 'strict' | 'moderate' | 'free';

export interface ApprovalResult {
  granted: boolean;
  reason: string;
  sessionAllowed?: boolean;
  /** Instructions de l'utilisateur données lors d'un refus (renvoyées à l'agent). */
  feedback?: string;
}

/** Demande d'approbation affichée dans le chat (façon Claude Code / Antigravity). */
export interface ApprovalPromptRequest {
  id: string;
  actionType: string;
  description: string;
  detail: string;
  params: Record<string, unknown>;
}

export interface ApprovalPromptDecision {
  decision: 'allow' | 'allow-session' | 'deny';
  /** Optionnel avec `deny` : ce que l'agent doit faire à la place. */
  feedback?: string;
}

/**
 * Prompt d'approbation délégué (carte dans le webview). Retourner `null`
 * pour retomber sur la boîte de dialogue native VS Code.
 */
export type ApprovalPromptHandler = (request: ApprovalPromptRequest) => Promise<ApprovalPromptDecision | null>;

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
  private promptHandler: ApprovalPromptHandler | null = null;
  private promptCounter = 0;

  constructor(mode: HITLMode = 'moderate') {
    this.mode = mode;
  }

  /** Délègue les confirmations au chat du webview (null = dialogue natif). */
  public setPromptHandler(handler: ApprovalPromptHandler | null): void {
    this.promptHandler = handler;
  }

  public setMode(mode: HITLMode): void {
    this.mode = mode;
  }

  public getMode(): HITLMode {
    return this.mode;
  }

  /**
   * Confirmation inconditionnelle (politique d'outil « ask first ») : demande
   * toujours à l'utilisateur, même en mode free — seule une autorisation de
   * session déjà accordée court-circuite le prompt.
   */
  public async askApproval(actionType: string, params: Record<string, unknown>): Promise<ApprovalResult> {
    const actionKey = this.getActionKey(actionType, params);
    if (this.sessionAllowances.has(actionKey)) {
      return { granted: true, reason: 'Autorisé pour cette session', sessionAllowed: true };
    }
    return await this.promptUser(actionType, params, actionKey);
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
    if (actionType === 'write_file' || actionType === 'edit_file' || actionType === 'edit_existing_file' || actionType === 'create_new_file') {
      const filePath = String(params.path ?? '');
      return filePath.includes('.env') || filePath.includes('package.json') || filePath.includes('tsconfig');
    }
    return false;
  }

  private getActionKey(actionType: string, params: Record<string, unknown>): string {
    if (actionType === 'terminal') return `terminal:${params.command}`;
    if (actionType === 'write_file' || actionType === 'edit_file' || actionType === 'delete_file' || actionType === 'edit_existing_file' || actionType === 'create_new_file') {
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

    // Carte d'approbation dans le chat si un handler est branché.
    if (this.promptHandler) {
      const decision = await this.promptHandler({
        id: `approval-${++this.promptCounter}`,
        actionType,
        description,
        detail,
        params
      });
      if (decision) {
        if (decision.decision === 'allow') {
          return { granted: true, reason: 'Approuvé par l\'utilisateur' };
        }
        if (decision.decision === 'allow-session') {
          this.sessionAllowances.add(actionKey);
          return { granted: true, reason: 'Approuvé pour la session', sessionAllowed: true };
        }
        return {
          granted: false,
          reason: 'Refusé par l\'utilisateur',
          feedback: decision.feedback?.trim() || undefined
        };
      }
      // null → webview indisponible, on retombe sur le dialogue natif.
    }

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
      case 'mcp': return `Appeler l'outil MCP: ${params._toolName ?? params.tool ?? '?'} (serveur: ${params._serverName ?? params.server ?? '?'})`;
      default: return actionType;
    }
  }
}
