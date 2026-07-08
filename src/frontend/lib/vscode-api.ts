interface VsCodeApi {
  postMessage(message: unknown): void;
  /** État léger persisté par la webview (survit au reload de la fenêtre). */
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi() may only be called once per webview — this module is the single call site.
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
export default vscode;
