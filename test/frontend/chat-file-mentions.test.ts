// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

/** Mock of acquireVsCodeApi installed before importing App (see settings-panel.test.ts). */
const posted = vi.hoisted(() => {
  const messages: Array<Record<string, unknown>> = [];
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage(message: unknown) {
      messages.push(structuredClone(message) as Record<string, unknown>);
    },
    getState() { return undefined; },
    setState() { /* no-op in test */ }
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

/** Simulates typing: value + caret + input event (bind:value + oninput). */
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

describe('@docs: mentions', () => {
  // Docs search is global (all indexed sources + the workspace's .md files,
  // see searchAllDocs on the backend): there's no "per site" selection. The
  // menu offers a single action that quotes the typed query, with known
  // sources only shown for reference in the detail.
  it('shows the quoted-query template as soon as "docs" is typed, before the colon', async () => {
    render(App);
    await tick();

    await type('@docs');
    const query = posted.find(m => m.type === 'queryDocs');
    expect(query).toBeTruthy();
    expect(query?.query).toBe('');

    postToWebview({ type: 'docsSuggestions', docs: [] });
    await tick();

    const item = screen.getByText('Search the docs');
    item.closest('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await tick();

    const el = chatTextarea();
    expect(el.value).toBe('@docs:"" ');
    expect(el.value.slice(0, el.selectionStart!)).toBe('@docs:"');
  });

  it('typing @docs: requests doc suggestions and shows a single quoted-query action', async () => {
    render(App);
    await tick();

    await type('@docs:');
    const query = posted.find(m => m.type === 'queryDocs');
    expect(query).toBeTruthy();
    expect(query?.query).toBe('');

    postToWebview({ type: 'docsSuggestions', docs: ['Svelte Docs', 'MDN'] });
    await tick();

    expect(screen.getByText('Search the docs')).toBeTruthy();
    expect(screen.getByText(/Svelte Docs, MDN/)).toBeTruthy();
  });

  it('wraps the typed query in quotes on accept, caret placed before the closing quote', async () => {
    render(App);
    await tick();

    await type('@docs:mdn');
    const queries = posted.filter(m => m.type === 'queryDocs');
    expect(queries.at(-1)?.query).toBe('mdn');

    postToWebview({ type: 'docsSuggestions', docs: ['MDN'] });
    await tick();

    const item = screen.getByText('Search: "mdn"');
    item.closest('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await tick();

    const el = chatTextarea();
    expect(el.value).toBe('@docs:"mdn" ');
    expect(el.selectionStart).toBe('@docs:"mdn'.length);
  });

  it('starts an empty quoted template so a multi-word question can be typed inside the quotes', async () => {
    render(App);
    await tick();

    await type('@docs:');
    postToWebview({ type: 'docsSuggestions', docs: [] });
    await tick();

    const item = screen.getByText('Search the docs');
    item.closest('li')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await tick();

    const el = chatTextarea();
    expect(el.value).toBe('@docs:"" ');
    const caret = el.selectionStart!;
    expect(el.value.slice(0, caret)).toBe('@docs:"');

    // A multi-word question typed at the caret stays between the quotes
    // already in place (the menu no longer touches the text once closed).
    const question = 'how do I create a mistral api ?';
    el.value = el.value.slice(0, caret) + question + el.value.slice(caret);
    el.setSelectionRange(caret + question.length, caret + question.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    expect(el.value).toBe('@docs:"how do I create a mistral api ?" ');
  });
});
