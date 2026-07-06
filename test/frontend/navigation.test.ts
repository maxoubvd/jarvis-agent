// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../../src/frontend/App.svelte';

/**
 * Régression du bug « menu inaccessible dans les paramètres » : en mode étroit
 * (webview < 500px), le bouton ☰ doit ouvrir le drawer de navigation depuis
 * n'importe quel onglet — y compris Settings — et le drawer doit permettre de
 * revenir sur les autres pages.
 */

beforeAll(() => {
  // happy-dom n'implémente pas la Web Animations API utilisée par
  // svelte/transition — on termine chaque animation au microtask suivant.
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
  // Laisse les transitions (stubbées) se terminer avant d'inspecter le DOM.
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

    // Aller dans Settings via le drawer.
    await click(menuButton());
    await click(drawerTab('Settings')!);
    // Le drawer se ferme à la navigation et la page Settings est affichée.
    expect(screen.queryByText('Navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: /Settings/ })).toBeTruthy();

    // Ré-ouvrir le drawer depuis Settings…
    await click(menuButton());
    expect(screen.getByText('Navigation')).toBeTruthy();

    // …et revenir sur une autre page.
    await click(drawerTab('Checkpoints')!);
    expect(screen.queryByText('Navigation')).toBeNull();
    expect(screen.getByRole('heading', { name: /Checkpoints/ })).toBeTruthy();
  });
});
