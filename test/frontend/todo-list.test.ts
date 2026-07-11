// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';

/** Mock d'acquireVsCodeApi installé avant l'import de l'App (cf. approval-diff-review.test.ts). */
vi.hoisted(() => {
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage() {},
    getState() { return undefined; },
    setState() { /* no-op en test */ }
  });
});

import App from '../../src/frontend/App.svelte';

function postToWebview(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

beforeEach(() => {
  cleanup();
});

describe('TODO list (agent checklist above the chat input)', () => {
  it('is absent from the DOM until a todoUpdate message arrives', async () => {
    render(App);
    await tick();
    expect(screen.queryByText(/Tasks \(/)).toBeNull();
  });

  it('renders items with a pending/in_progress/completed status once received', async () => {
    render(App);
    await tick();

    postToWebview({
      type: 'todoUpdate',
      items: [
        { id: '1', content: 'Read the spec', status: 'completed' },
        { id: '2', content: 'Write the code', status: 'in_progress' },
        { id: '3', content: 'Run the tests', status: 'pending' }
      ]
    });
    await tick();

    expect(screen.getByText('Tasks (1/3)')).toBeTruthy();
    expect(screen.getByText('Read the spec')).toBeTruthy();
    expect(screen.getByText('Write the code')).toBeTruthy();
    expect(screen.getByText('Run the tests')).toBeTruthy();
  });

  it('clears the checklist when an empty todoUpdate arrives (e.g. on /new)', async () => {
    render(App);
    await tick();

    postToWebview({ type: 'todoUpdate', items: [{ id: '1', content: 'Task', status: 'pending' }] });
    await tick();
    expect(screen.getByText('Task')).toBeTruthy();

    postToWebview({ type: 'todoUpdate', items: [] });
    await tick();
    expect(screen.queryByText('Task')).toBeNull();
    expect(screen.queryByText(/Tasks \(/)).toBeNull();
  });
});
