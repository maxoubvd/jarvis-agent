import { describe, it, expect } from 'vitest';
import App from '../../src/frontend/App.svelte';

describe('App Component', () => {
  it('should have the correct component structure', () => {
    // Basic test to verify component exists and can be imported
    expect(App).toBeDefined();
    expect(typeof App).toBe('function');
  });

  it('should have a name property', () => {
    // Verify component has a name
    expect(App.name).toBe('App');
  });
});
