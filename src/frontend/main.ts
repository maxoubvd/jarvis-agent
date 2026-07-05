import './styles/vscode-theme.css';
import { mount } from 'svelte';
import App from './App.svelte';
import vscode from './lib/vscode-api';

if (typeof window !== 'undefined') {
  const target = document.getElementById('app');

  if (!target) {
    console.error('Element #app introuvable');
  } else {
    try {
      mount(App, { target });
      vscode?.postMessage({ type: 'webviewReady', data: { ready: true, timestamp: Date.now() } });
      console.log('Jarvis webview initialisée');
    } catch (error) {
      console.error('Échec initialisation Svelte:', error);
      showFallbackError(error);
    }
  }
}

function showFallbackError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const fallback = document.createElement('div');
  fallback.style.cssText = 'padding:2rem;text-align:center;color:var(--vscode-editor-foreground,#fff)';
  fallback.innerHTML = `
    <h2>Jarvis Agent</h2>
    <p>Erreur de chargement de l'interface</p>
    <div style="margin-top:1rem;padding:1rem;background:rgba(255,0,0,0.1);border-radius:4px;">${message}</div>
  `;
  document.body.innerHTML = '';
  document.body.appendChild(fallback);
}
