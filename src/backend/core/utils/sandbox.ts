import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';

export interface AccessResult {
  allowed: boolean;
  reason?: string;
}

export class SandboxManager {
  private workspaceRoot: string;
  private ignorePatterns: string[] = [];
  private ignorePath: string;

  constructor(workspaceRoot?: string) {
    const folder = workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) {
      throw new Error('Workspace introuvable');
    }
    this.workspaceRoot = path.resolve(folder).replace(/\\/g, '/');
    this.ignorePath = path.join(folder, '.jarvisignore');
    this.loadIgnorePatterns();
  }

  private loadIgnorePatterns(): void {
    try {
      const fsSync = require('fs');
      if (!fsSync.existsSync(this.ignorePath)) {
        this.generateDefaultIgnore();
        return;
      }
      const content: string = fsSync.readFileSync(this.ignorePath, 'utf-8');
      this.parseIgnoreFile(content);
    } catch {
      this.ignorePatterns = this.getDefaultPatterns();
    }
  }

  private parseIgnoreFile(content: string): void {
    this.ignorePatterns = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  }

  private getDefaultPatterns(): string[] {
    return [
      '.env', '.env.*', '*.env',
      'node_modules/', 'vendor/', 'bower_components/',
      'dist/', 'build/', 'out/',
      '.cache/', '.tmp/', '*.tmp',
      '.git/', '.vscode/',
      '*.pem', '*.key', '*.crt', '*.pfx',
      'secrets/', 'credentials/',
      '*.db', '*.sqlite', '*.sqlite3',
      '.jarvis/', '.jarvisignore',
      'jarvis-*.json'
    ];
  }

  private async generateDefaultIgnore(): Promise<void> {
    const content = [
      '# Jarvis Ignore File — fichiers invisibles pour l\'IA',
      '# Généré automatiquement — modifiable manuellement',
      '',
      '# Environnement et secrets',
      '.env',
      '.env.*',
      '*.env',
      '!.env.example',
      '',
      '# Dépendances',
      'node_modules/',
      'vendor/',
      'bower_components/',
      '',
      '# Build artifacts',
      'dist/',
      'build/',
      'out/',
      '',
      '# Cache et temporaires',
      '.cache/',
      '.tmp/',
      '*.tmp',
      '.DS_Store',
      '',
      '# IDE',
      '.idea/',
      '.vscode/',
      '',
      '# Sécurité',
      '*.pem',
      '*.key',
      '*.crt',
      '*.pfx',
      'secrets/',
      'credentials/',
      '',
      '# Bases de données',
      '*.db',
      '*.sqlite',
      '*.sqlite3',
      '',
      '# Jarvis interne',
      '.jarvis/',
      '.jarvisignore',
      'jarvis-*.json'
    ].join('\n');

    try {
      await fs.writeFile(this.ignorePath, content, 'utf-8');
    } catch {
      // Ignore write errors
    }
    this.ignorePatterns = this.getDefaultPatterns();
  }

  public async reloadIgnorePatterns(): Promise<void> {
    try {
      const content = await fs.readFile(this.ignorePath, 'utf-8');
      this.parseIgnoreFile(content);
    } catch {
      this.ignorePatterns = this.getDefaultPatterns();
    }
  }

  public canAccess(filePath: string): AccessResult {
    const normalized = path.resolve(filePath).replace(/\\/g, '/');
    const workspaceNorm = this.workspaceRoot;

    if (!normalized.startsWith(workspaceNorm)) {
      return { allowed: false, reason: `Chemin hors du workspace: ${filePath}` };
    }

    const relative = normalized.slice(workspaceNorm.length).replace(/^\//, '');

    for (const pattern of this.ignorePatterns) {
      if (pattern.startsWith('!')) {
        continue;
      }
      if (this.matchesPattern(relative, pattern)) {
        return { allowed: false, reason: `Chemin ignoré par .jarvisignore (pattern: ${pattern})` };
      }
    }

    return { allowed: true };
  }

  private matchesPattern(filePath: string, pattern: string): boolean {
    // Remove trailing slash for directory patterns (match both file and dir)
    const pat = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    const regexStr = pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '###DOUBLESTAR###')
      .replace(/\*/g, '[^/]*')
      .replace(/###DOUBLESTAR###/g, '.*');

    try {
      const regex = new RegExp(`(^|/)${regexStr}($|/)`, 'i');
      return regex.test(filePath);
    } catch {
      return filePath.includes(pat);
    }
  }
}
