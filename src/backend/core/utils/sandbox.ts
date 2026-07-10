import * as fs from 'fs/promises';
import * as fsSync from 'fs';
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
      if (!fsSync.existsSync(this.ignorePath)) {
        this.generateDefaultIgnoreSync();
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

  private async generateDefaultIgnoreAsync(): Promise<void> {
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
      const uri = vscode.Uri.file(this.ignorePath);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    } catch (e) {
      console.error('Failed to create .jarvisignore', e);
    }
    this.ignorePatterns = this.getDefaultPatterns();
  }

  private generateDefaultIgnoreSync(): void {
    // Version synchrone utilisée dans le constructeur ; ensureIgnoreFile() (async, appelée
    // depuis activate()) régénère ensuite le contenu complet via generateDefaultIgnoreAsync().
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
      fsSync.writeFileSync(this.ignorePath, content, 'utf-8');
    } catch (err) {
      console.error('Jarvis: échec de l\'écriture synchrone de .jarvisignore:', err);
    }
    this.ignorePatterns = this.getDefaultPatterns();
  }

  /** Ensure the ignore file exists asynchronously */
  public async ensureIgnoreFile(): Promise<void> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(this.ignorePath));
    } catch {
      // File does not exist
      await this.generateDefaultIgnoreAsync();
    }
  }

  /** Régénère le fichier .jarvisignore avec les patterns recommandés. */
  public async regenerateIgnoreFile(): Promise<void> {
    await this.generateDefaultIgnoreAsync();
  }

  public getIgnorePatterns(): string[] {
    return [...this.ignorePatterns];
  }

  /** Ajoute un pattern à .jarvisignore (commande "Add to .jarvisignore"). */
  public async addIgnorePattern(pattern: string): Promise<void> {
    const trimmed = pattern.trim();
    if (!trimmed || this.ignorePatterns.includes(trimmed)) return;
    this.ignorePatterns.push(trimmed);
    await this.persistPatterns();
  }

  /** Retire un pattern de .jarvisignore (commande "Remove from .jarvisignore"). */
  public async removeIgnorePattern(pattern: string): Promise<void> {
    this.ignorePatterns = this.ignorePatterns.filter(p => p !== pattern);
    await this.persistPatterns();
  }

  private async persistPatterns(): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.ignorePath, 'utf-8');
    } catch {
      content = '# Jarvis Ignore File — fichiers invisibles pour l\'IA\n';
    }
    const existing = new Set(
      content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    );
    const lines = content.split('\n').filter(l => {
      const t = l.trim();
      return !t || t.startsWith('#') || this.ignorePatterns.includes(t);
    });
    for (const pattern of this.ignorePatterns) {
      if (!existing.has(pattern)) {
        lines.push(pattern);
      }
    }
    try {
      await fs.writeFile(this.ignorePath, lines.join('\n'), 'utf-8');
    } catch {
      // Ignore write errors
    }
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

    const isWindows = process.platform === 'win32';
    const compNormalized = isWindows ? normalized.toLowerCase() : normalized;
    const compWorkspace = isWindows ? workspaceNorm.toLowerCase() : workspaceNorm;

    if (compNormalized !== compWorkspace && !compNormalized.startsWith(compWorkspace + '/')) {
      return { allowed: false, reason: `Chemin hors du workspace: ${filePath}` };
    }

    const relative = normalized.slice(workspaceNorm.length).replace(/^\//, '');

    // Patterns de négation (!pattern) : ré-autorisent explicitement (ex: !.env.example)
    for (const pattern of this.ignorePatterns) {
      if (pattern.startsWith('!') && this.matchesPattern(relative, pattern.slice(1))) {
        return this.checkSymlink(filePath);
      }
    }

    for (const pattern of this.ignorePatterns) {
      if (pattern.startsWith('!')) {
        continue;
      }
      if (this.matchesPattern(relative, pattern)) {
        return { allowed: false, reason: `Chemin ignoré par .jarvisignore (pattern: ${pattern})` };
      }
    }

    return this.checkSymlink(filePath);
  }

  /**
   * Protection symlink (spec §6.1) : bloque les liens symboliques qui
   * pourraient pointer hors du workspace.
   */
  private checkSymlink(filePath: string): AccessResult {
    try {
      let current = path.resolve(filePath);
      const root = path.resolve(this.workspaceRoot);
      while (current.replace(/\\/g, '/').startsWith(root.replace(/\\/g, '/')) && current !== root) {
        if (fsSync.existsSync(current) && fsSync.lstatSync(current).isSymbolicLink()) {
          return { allowed: false, reason: `Lien symbolique détecté: ${current}` };
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    } catch {
      // lstat impossible → on n'empêche pas l'accès pour autant
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
