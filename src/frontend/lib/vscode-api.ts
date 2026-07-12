interface VsCodeApi {
  postMessage(message: unknown): void;
  /** Lightweight state persisted by the webview (survives a window reload). */
  getState<T = unknown>(): T | undefined;
  setState<T = unknown>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi() may only be called once per webview — this module is the single call site.
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
export default vscode;
