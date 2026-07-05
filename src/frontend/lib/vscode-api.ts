declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

// acquireVsCodeApi() may only be called once per webview — this module is the single call site.
const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
export default vscode;
