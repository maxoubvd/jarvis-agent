export interface RequestTokenRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from the provider's implicit cache (0 if none). */
  cachedTokens?: number;
  timestamp: string;
}

export type UsageLevel = 'green' | 'orange' | 'red';

export interface TokenUsage {
  used: number;
  inputTokens: number;
  outputTokens: number;
  /** Total tokens served from the provider's cache (cost/latency savings). */
  cachedTokens: number;
  /** Context length of the configured model; `null` if no model. */
  limit: number | null;
  percentage: number;
  level: UsageLevel;
  /** History of the last 5 requests (spec §2.1). */
  history: RequestTokenRecord[];
}

/** Serializable state persisted in `workspaceState` (survives reload + restart). */
export interface TokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  history: RequestTokenRecord[];
}

const HISTORY_SIZE = 5;

/** Rough estimate without a tokenizer (≈ 4 characters / token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Bidirectional session token counter (spec §3.2):
 * separate input/output, model limit, visual thresholds, history.
 */
export class TokenCounter {
  private inputTokens = 0;
  private outputTokens = 0;
  private cachedTokens = 0;
  private limit: number | null;
  private history: RequestTokenRecord[] = [];

  constructor(limit: number | null = null) {
    this.limit = limit;
  }

  /** `null` = no model configured (the gauge shows "0 / —"). */
  public setLimit(limit: number | null): void {
    this.limit = limit !== null && limit > 0 ? limit : null;
  }

  public addRequest(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): void {
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.cachedTokens += cachedTokens;
    this.history.unshift({
      model,
      inputTokens,
      outputTokens,
      cachedTokens: cachedTokens || undefined,
      timestamp: new Date().toISOString()
    });
    this.history = this.history.slice(0, HISTORY_SIZE);
  }

  public reset(): void {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.cachedTokens = 0;
    this.history = [];
  }

  /** Serializable snapshot for persistence (`workspaceState`). */
  public serialize(): TokenSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cachedTokens: this.cachedTokens,
      history: [...this.history]
    };
  }

  /**
   * Restores a snapshot (session resume). Does not touch `limit`:
   * it is always derived from the current model via {@link setLimit}.
   */
  public restore(snapshot: TokenSnapshot | null | undefined): void {
    if (!snapshot) return;
    this.inputTokens = snapshot.inputTokens ?? 0;
    this.outputTokens = snapshot.outputTokens ?? 0;
    this.cachedTokens = snapshot.cachedTokens ?? 0;
    this.history = Array.isArray(snapshot.history) ? snapshot.history.slice(0, HISTORY_SIZE) : [];
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
      cachedTokens: this.cachedTokens,
      limit: this.limit,
      percentage,
      level,
      history: [...this.history]
    };
  }

  /** Warning near the model's limit (spec §3.2). */
  public isNearLimit(): boolean {
    return this.getUsage().percentage >= 80;
  }
}
