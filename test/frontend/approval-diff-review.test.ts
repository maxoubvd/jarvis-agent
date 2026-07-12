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
    setState() { /* no-op in tests */ }
  });
  return messages;
});

import App from '../../src/frontend/App.svelte';

function postToWebview(data: Record<string, unknown>) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

beforeEach(() => {
  cleanup();
  posted.length = 0;
});

const REQUEST = {
  type: 'approvalRequest',
  id: 'approval-1',
  actionType: 'terminal',
  description: 'Execute: npm test',
  detail: 'command: npm test'
};

describe('in-chat approval card', () => {
  it('renders the request and posts allow-session on click', async () => {
    render(App);
    await tick();

    postToWebview(REQUEST);
    await tick();

    expect(screen.getByText('Execute: npm test')).toBeTruthy();
    screen.getByRole('button', { name: 'Allow for this session' }).click();
    await tick();

    const response = posted.find(m => m.type === 'approvalResponse');
    expect(response).toMatchObject({ id: 'approval-1', decision: 'allow-session' });
    // The card disappears after the decision.
    expect(screen.queryByText('Execute: npm test')).toBeNull();
  });

  it('deny opens a feedback field whose content is sent to the agent', async () => {
    render(App);
    await tick();

    postToWebview(REQUEST);
    await tick();

    screen.getByRole('button', { name: /Deny…/ }).click();
    await tick();

    const textarea = screen.getByPlaceholderText(/what to do instead|Don't run/i) as HTMLTextAreaElement;
    textarea.value = 'Only run the linter';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();

    screen.getByRole('button', { name: 'Send denial' }).click();
    await tick();

    const response = posted.find(m => m.type === 'approvalResponse');
    expect(response).toMatchObject({
      id: 'approval-1',
      decision: 'deny',
      feedback: 'Only run the linter'
    });
  });
});

const CHANGES = {
  type: 'pendingChanges',
  changes: [
    {
      path: 'src/app.ts',
      isNew: false,
      revision: 3,
      hunks: [
        {
          id: 0,
          beforeStart: 2,
          afterStart: 2,
          beforeLines: ['const a = 1;'],
          afterLines: ['const a = 2;'],
          contextBefore: ['// header'],
          contextAfter: ['export {};']
        }
      ]
    },
    {
      path: 'new.ts',
      isNew: true,
      revision: 1,
      hunks: [
        {
          id: 0,
          beforeStart: 1,
          afterStart: 1,
          beforeLines: [],
          afterLines: ['contenu'],
          contextBefore: [],
          contextAfter: []
        }
      ]
    }
  ]
};

describe('diff review panel', () => {
  it('renders red/green hunks and resolves a single hunk', async () => {
    render(App);
    await tick();

    postToWebview(CHANGES);
    await tick();

    expect(screen.getByText('src/app.ts')).toBeTruthy();
    expect(screen.getByText('new file')).toBeTruthy();
    expect(screen.getByText(/- const a = 1;/)).toBeTruthy();
    expect(screen.getByText(/\+ const a = 2;/)).toBeTruthy();

    // Accept the first hunk of src/app.ts.
    const fileCard = screen.getByText('src/app.ts').closest('.file') as HTMLElement;
    (fileCard.querySelector('.hunk-btn') as HTMLElement).click();
    await tick();

    const msg = posted.find(m => m.type === 'resolveHunk');
    expect(msg).toMatchObject({ path: 'src/app.ts', hunkId: 0, revision: 3, action: 'accept' });
  });

  it('accept file and accept all post the right messages', async () => {
    render(App);
    await tick();
    postToWebview(CHANGES);
    await tick();

    screen.getAllByRole('button', { name: /Accept file/ })[0].click();
    await tick();
    expect(posted.find(m => m.type === 'resolveFile')).toMatchObject({
      path: 'src/app.ts',
      action: 'accept'
    });

    screen.getByRole('button', { name: 'Accept all' }).click();
    await tick();
    expect(posted.find(m => m.type === 'resolveAll')).toMatchObject({ action: 'accept' });
  });
});
