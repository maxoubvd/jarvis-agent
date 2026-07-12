import './styles/vscode-theme.css';
import './styles/tokens.css';
import { mount } from 'svelte';
import App from './App.svelte';
import vscode from './lib/vscode-api';

if (typeof window !== 'undefined') {
  const target = document.getElementById('app');

  if (!target) {
    console.error('Element #app not found');
  } else {
    try {
      mount(App, { target });
      vscode?.postMessage({ type: 'webviewReady', data: { ready: true, timestamp: Date.now() } });
      console.log('Jarvis webview initialized');
    } catch (error) {
      console.error('Svelte initialization failed:', error);
      showFallbackError(error);
    }
  }
}

function showFallbackError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fallback = document.createElement('div');
  fallback.style.cssText = 'padding:2rem;text-align:center;color:var(--vscode-editor-foreground,#fff)';
  fallback.innerHTML = `
    <h2><svg width="24" height="24" viewBox="0 0 360 360" fill="none" stroke="var(--jarvis-accent)" stroke-width="24" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -4px; margin-right: 8px;"><path d="M 152 106 L 236 106 M 218 106 L 218 220 A 51 51 0 0 1 116 220" /></svg>Jarvis Agent</h2>
    <p>Error loading the interface</p>
    <div style="margin-top:1rem;padding:1rem;background:rgba(255,0,0,0.1);border-radius:4px;">${message}</div>
  `;
  document.body.innerHTML = '';
  document.body.appendChild(fallback);
}
