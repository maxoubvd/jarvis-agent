export interface RequestTokenRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: string;
}

export type UsageLevel = 'green' | 'orange' | 'red';

export interface TokenUsage {
  used: number;
  inputTokens: number;
  outputTokens: number;
  limit: number;
  percentage: number;
  level: UsageLevel;
  /** Historique des 5 dernières requêtes (spec §2.1). */
  history: RequestTokenRecord[];
}

const HISTORY_SIZE = 5;

/** Estimation approximative sans tokenizer (≈ 4 caractères / token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compteur de tokens bidirectionnel de session (spec §3.2) :
 * input/output séparés, limite du modèle, seuils visuels, historique.
 */
export class TokenCounter {
  private inputTokens = 0;
  private outputTokens = 0;
  private limit: number;
  private history: RequestTokenRecord[] = [];

  constructor(limit = 32768) {
    this.limit = limit;
  }

  public setLimit(limit: number): void {
    if (limit > 0) {
      this.limit = limit;
    }
  }

  public addRequest(model: string, inputTokens: number, outputTokens: number): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.history.unshift({
      model,
      inputTokens,
      outputTokens,
      timestamp: new Date().toISOString()
    });
    this.history = this.history.slice(0, HISTORY_SIZE);
  }

  public reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.history = [];
  }

  public getUsage(): TokenUsage {
    const used = this.inputTokens + this.outputTokens;
    const percentage = Math.min(100, Math.round((used / this.limit) * 100));
    const level: UsageLevel = percentage < 50 ? 'green' : percentage < 80 ? 'orange' : 'red';
    return {
      used,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      limit: this.limit,
      percentage,
      level,
      history: [...this.history]
    };
  }

  /** Avertissement à l'approche de la limite du modèle (spec §3.2). */
  public isNearLimit(): boolean {
    return this.getUsage().percentage >= 80;
  }
}
