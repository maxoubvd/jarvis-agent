import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export interface ActionMetadata {
  type: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  duration: number;
  status: 'success' | 'error';
  accepted?: boolean;
}

interface ActionRecord extends ActionMetadata {
  id: string;
  timestamp: string;
}

interface ModelStats {
  tokensUsed: number;
  actions: number;
  successCount: number;
}

interface JarvisStats {
  version: string;
  metadata: { createdAt: string; updatedAt: string };
  summary: {
    totalActions: number;
    totalTokens: number;
    successCount: number;
  };
  models: Record<string, ModelStats>;
  actionsByType: Record<string, { count: number; successCount: number }>;
  recentActions: ActionRecord[];
}

/** Rough token estimate — good enough for local analytics without a tokenizer. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class AnalyticsCollector {
  private statsPath: string;
  private stats: JarvisStats;

  constructor() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
      throw new Error('Workspace introuvable');
    }
    const dir = path.join(workspaceFolder, '.vscode');
    this.statsPath = path.join(dir, 'jarvis-stats.json');
    this.stats = this.load();
  }

  private load(): JarvisStats {
    try {
      if (fsSync.existsSync(this.statsPath)) {
        return JSON.parse(fsSync.readFileSync(this.statsPath, 'utf-8')) as JarvisStats;
      }
    } catch {
      // fall through to fresh stats
    }
    return {
      version: '1.0',
      metadata: { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      summary: { totalActions: 0, totalTokens: 0, successCount: 0 },
      models: {},
      actionsByType: {},
      recentActions: []
    };
  }

  public trackAction(action: ActionMetadata): void {
    const totalTokens = action.inputTokens + action.outputTokens;
    const record: ActionRecord = {
      ...action,
      id: `action-${Date.now()}`,
      timestamp: new Date().toISOString()
    };

    this.stats.summary.totalActions++;
    this.stats.summary.totalTokens += totalTokens;
    if (action.status === 'success') this.stats.summary.successCount++;

    const model = this.stats.models[action.model] ?? { tokensUsed: 0, actions: 0, successCount: 0 };
    model.tokensUsed += totalTokens;
    model.actions++;
    if (action.status === 'success') model.successCount++;
    this.stats.models[action.model] = model;

    const byType = this.stats.actionsByType[action.type] ?? { count: 0, successCount: 0 };
    byType.count++;
    if (action.status === 'success') byType.successCount++;
    this.stats.actionsByType[action.type] = byType;

    this.stats.recentActions.unshift(record);
    this.stats.recentActions = this.stats.recentActions.slice(0, 50);
    this.stats.metadata.updatedAt = new Date().toISOString();

    void this.save();
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.statsPath), { recursive: true });
      await fs.writeFile(this.statsPath, JSON.stringify(this.stats, null, 2), 'utf-8');
    } catch {
      // Non-fatal — analytics must never break the main flow
    }
  }

  public getStats(): JarvisStats {
    return this.stats;
  }

  /** Writes a formatted export and opens it in the editor. */
  public async export(): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) return;

    const exportPath = path.join(workspaceFolder, '.vscode', `jarvis-analytics-export-${Date.now()}.json`);
    await fs.mkdir(path.dirname(exportPath), { recursive: true });
    await fs.writeFile(exportPath, JSON.stringify(this.stats, null, 2), 'utf-8');

    const doc = await vscode.workspace.openTextDocument(exportPath);
    await vscode.window.showTextDocument(doc);
  }
}
