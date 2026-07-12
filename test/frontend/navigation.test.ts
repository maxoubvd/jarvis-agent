// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../../src/frontend/App.svelte';

/**
 * Regression test for bug "menu inaccessible in settings": in narrow mode
 * (webview < 500px), the ☰ button must open the navigation drawer from
 * any tab — including Settings — and the drawer must allow returning
 * to other pages.
 */

beforeAll(() => {
  // happy-dom does not implement the Web Animations API used by
  // svelte/transition — we end each animation at the next microtask.
  Element.prototype.animate = function () {
    const animation = {
      cancel: () => {},
      finish: () => {},
      onfinish: null as null | (() => void),
      oncancel: null as null | (() => void)
    };
    queueMicrotask(() => animation.onfinish?.());
    return animation as unknown as Animation;
  };
});

function setNarrowViewport() {
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true, writable: true });
  window.dispatchEvent(new Event('resize'));
}

function menuButton(): HTMLElement {
  return screen.getByLabelText('Toggle navigation');
}

function drawerTab(label: string): HTMLElement | undefined {
  return screen.queryAllByRole('button', { name: label }).at(-1);
}

async function click(el: HTMLElement) {
  el.click();
  await tick();
  // Let the transitions (stubbed) finish before inspecting the DOM.
  await new Promise(resolve => setTimeout(resolve, 0));
  await tick();
}

async function renderNarrowApp() {
  render(App);
  setNarrowViewport();
  await tick();
}

beforeEach(() => {
  cleanup();
  setNarrowViewport();
});

describe('narrow-mode navigation drawer', () => {
  it('shows the menu button instead of the inline sidebar', async () => {
    await renderNarrowApp();
    expect(menuButton()).toBeTruthy();
    expect(screen.queryByText('Navigation')).toBeNull();
  });

  it('opens and closes the drawer from the chat tab', async () => {
    await renderNarrowApp();
    await click(menuButton());
    expect(screen.getByText('Navigation')).toBeTruthy();
    await click(menuButton());
    expect(screen.queryByText('Navigation')).toBeNull();
  });

  it('re-opens the drawer while on the Settings tab (reported bug)', async () => {
    await renderNarrowApp();

    // Go to Settings via the drawer.
    await click(menuButton());
    await click(drawerTab('Settings')!);
    // The drawer closes on navigation and the Settings page is displayed.
    expect(screen.queryByText('Navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: /Settings/ })).toBeTruthy();

    // Re-open the drawer from Settings...
    await click(menuButton());
    expect(screen.getByText('Navigation')).toBeTruthy();

    // ...and return to another page.
    await click(drawerTab('Checkpoints')!);
    expect(screen.queryByText('Navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: /Checkpoints/ })).toBeTruthy();
  });
});
