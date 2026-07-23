/**
 * Minimal, host-agnostic event emitter that mirrors the shape of
 * `vscode.EventEmitter<T>` (`.event(listener) => Disposable` + `.fire(data)`),
 * so shared core services can expose events without importing `vscode`.
 * The VS Code extension can subscribe with the exact same `.event(...)` call it
 * used before; the CLI subscribes the same way.
 */
export interface Disposable {
  dispose(): void;
}

export type Listener<T> = (e: T) => void;

export class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();

  public readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  public fire(data: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(data);
      } catch {
        // A misbehaving listener must never break event dispatch.
      }
    }
  }

  public dispose(): void {
    this.listeners.clear();
  }
}
