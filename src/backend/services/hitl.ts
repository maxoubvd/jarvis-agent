import * as vscode from 'vscode';

export type HITLMode = 'strict' | 'moderate' | 'free';

export interface ApprovalResult {
  granted: boolean;
  reason: string;
  sessionAllowed?: boolean;
  /** User instructions given on a denial (sent back to the agent). */
  feedback?: string;
}

/** Approval request displayed in the chat (Claude Code / Antigravity style). */
export interface ApprovalPromptRequest {
  id: string;
  actionType: string;
  description: string;
  detail: string;
  params: Record<string, unknown>;
}

export interface ApprovalPromptDecision {
  decision: 'allow' | 'allow-session' | 'deny';
  /** Optional with `deny`: what the agent should do instead. */
  feedback?: string;
}

/**
 * Delegated approval prompt (card in the webview). Return `null`
 * to fall back to the native VS Code dialog.
 */
export type ApprovalPromptHandler = (request: ApprovalPromptRequest) => Promise<ApprovalPromptDecision | null>;

const DANGEROUS_PATTERNS = [
  'del /f', 'rmdir /s',
  'git push', 'git reset --hard', 'git clean',
  'npm install --global', 'npm install -g',
  'chmod 777', 'sudo ',
  'DROP TABLE', 'DELETE FROM', 'TRUNCATE'
];

/** Matches `rm` as a standalone command (e.g. "rm x", "cd a && rm -rf b"), not a substring of "confirm"/"germ"/"term". */
const RM_COMMAND_PATTERN = /(^|[\s;&|])rm(\s|$)/;

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

  /** Delegates confirmations to the webview chat (null = native dialog). */
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
   * Unconditional confirmation ("ask first" tool policy): always asks the
   * user, even in free mode — only an already-granted session allowance
   * short-circuits the prompt.
   */
  public async askApproval(actionType: string, params: Record<string, unknown>): Promise<ApprovalResult> {
    const actionKey = this.getActionKey(actionType, params);
    if (this.sessionAllowances.has(actionKey)) {
      return { granted: true, reason: 'Allowed for this session', sessionAllowed: true };
    }
    return await this.promptUser(actionType, params, actionKey);
  }

  public async checkApproval(actionType: string, params: Record<string, unknown>): Promise<ApprovalResult> {
    if (this.mode === 'free') {
      return { granted: true, reason: 'Free mode enabled' };
    }

    const actionKey = this.getActionKey(actionType, params);

    if (this.sessionAllowances.has(actionKey)) {
      return { granted: true, reason: 'Allowed for this session', sessionAllowed: true };
    }

    const isSafe = this.isSafeAction(actionType, params);
    const isDangerous = this.isDangerousAction(actionType, params);

    if (this.mode === 'moderate') {
      if (isSafe) {
        return { granted: true, reason: 'Safe action — automatically approved' };
      }
      if (!isDangerous) {
        return { granted: true, reason: 'Moderate mode — action approved' };
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
      if (RM_COMMAND_PATTERN.test(command)) return true;
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

    // Approval card in the chat if a handler is wired up.
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
          return { granted: true, reason: 'Approved by user' };
        }
        if (decision.decision === 'allow-session') {
          this.sessionAllowances.add(actionKey);
          return { granted: true, reason: 'Allowed for the session', sessionAllowed: true };
        }
        return {
          granted: false,
          reason: 'Denied by user',
          feedback: decision.feedback?.trim() || undefined
        };
      }
      // null → webview unavailable, falling back to native dialog.
    }

    const result = await vscode.window.showInformationMessage(
      `Jarvis needs to run an action: ${description}`,
      { modal: true, detail },
      'Approve',
      'Approve for session',
      'Deny'
    );

    if (result === 'Approve') {
      return { granted: true, reason: 'Approved by user' };
    }

    if (result === 'Approve for session') {
      this.sessionAllowances.add(actionKey);
      return { granted: true, reason: 'Approved for the session', sessionAllowed: true };
    }

    return { granted: false, reason: 'User denied or dismissed prompt' };
  }

  private describeAction(actionType: string, params: Record<string, unknown>): string {
    switch (actionType) {
      case 'edit_file': return `Edit: ${params.path}`;
      case 'delete_file': return `Delete: ${params.path}`;
      case 'read_file': return `Read: ${params.path}`;
      case 'web_search': return `Search: ${params.query}`;
      case 'mcp': return `Call MCP tool: ${params._toolName ?? params.tool ?? '?'} (server: ${params._serverName ?? params.server ?? '?'})`;
      default: return actionType;
    }
  }
}
