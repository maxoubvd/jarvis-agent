// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

/** Mock d'acquireVsCodeApi installé avant l'import de l'App (cf. settings-panel.test.ts). */
const posted = vi.hoisted(() => {
  const messages: Array<Record<string, unknown>> = [];
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage(message: unknown) {
      messages.push(structuredClone(message) as Record<string, unknown>);
    },
    getState() { return undefined; },
    setState() { /* no-op en test */ }
  });
  return messages;
});

import App from '../../src/frontend/App.svelte';

function postToWebview(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

function chatTextarea(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Ask anything/) as HTMLTextAreaElement;
}

/** Simule la frappe : valeur + caret + événement input (bind:value + oninput). */
async function type(text: string) {
  const el = chatTextarea();
  el.value = text;
  el.setSelectionRange(text.length, text.length);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await tick();
}

beforeEach(() => {
  cleanup();
  posted.length = 0;
});

describe('@ file mentions (Claude Code style)', () => {
  it('typing @ requests file suggestions and lists them in the menu', async () => {
    render(App);
    await tick();

    await type('@');
    const query = posted.find(m => m.type === 'queryFiles');
    expect(query).toBeTruthy();
    expect(query?.query).toBe('');

    postToWebview({ type: 'fileSuggestions', query: '', files: ['src/main.ts', 'README.md'] });
    await tick();

    expect(screen.getByText('src/main.ts')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();
  });

  it('typing a partial path narrows the query and inserts @file:<path> on accept', async () => {
    render(App);
    await tick();

    await type('@readm');
    const queries = posted.filter(m => m.type === 'queryFiles');
    expect(queries.at(-1)?.query).toBe('readm');

    postToWebview({ type: 'fileSuggestions', query: 'readm', files: ['README.md'] });
    await tick();

    const item = screen.getByText('README.md');
    item.closest('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await tick();

    expect(chatTextarea().value).toBe('@file:README.md ');
  });

  it('quotes paths containing spaces so the mention stays parseable', async () => {
    render(App);
    await tick();

    await type('@file:my');
    postToWebview({ type: 'fileSuggestions', query: 'my', files: ['my folder/read me.md'] });
    await tick();

    const item = screen.getByText('my folder/read me.md');
    item.closest('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await tick();

    expect(chatTextarea().value).toBe('@file:"my folder/read me.md" ');
  });
});
