/**
 * Journalisation de toutes les opérations de l'agent (spec §4.1 / §6 —
 * "Transparence totale"). Les écouteurs (OutputChannel VS Code, webview)
 * s'abonnent aux entrées.
 */

export interface OperationLogEntry {
  timestamp: string;
  operation: string;
  details: string;
  status: 'info' | 'success' | 'error' | 'blocked';
}

type LogListener = (entry: OperationLogEntry) => void;

const MAX_ENTRIES = 500;

export class OperationLogger {
  private entries: OperationLogEntry[] = [];
  private listeners: LogListener[] = [];

  public log(operation: string, details: string, status: OperationLogEntry['status'] = 'info'): void {
    const entry: OperationLogEntry = {
      timestamp: new Date().toISOString(),
      operation,
      details,
      status
    };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // un écouteur défaillant ne doit pas casser la journalisation
      }
    }
  }

  public onEntry(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  public getEntries(): OperationLogEntry[] {
    return [...this.entries];
  }
}

/** Instance partagée par l'extension. */
export const operationLogger = new OperationLogger();
