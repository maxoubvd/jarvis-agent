// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Probe from './Probe.svelte';

describe('probe', () => {
  it('renders an imported constant in the template', () => {
    render(Probe);
    expect(screen.getByText('Jarvis Agent')).toBeTruthy();
  });
});
