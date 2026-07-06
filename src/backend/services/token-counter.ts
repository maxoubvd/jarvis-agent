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
  /** Longueur de contexte du modèle configuré ; `null` si aucun modèle. */
  limit: number | null;
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
  private limit: number | null;
  private history: RequestTokenRecord[] = [];

  constructor(limit: number | null = null) {
    this.limit = limit;
  }

  /** `null` = aucun modèle configuré (la jauge affiche « 0 / — »). */
  public setLimit(limit: number | null): void {
    this.limit = limit !== null && limit > 0 ? limit : null;
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
    const limit = this.limit;
    const percentage = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
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
