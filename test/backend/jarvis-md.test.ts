import { describe, it, expect } from 'vitest';
import { loadJarvisMd, renderJarvisMd } from '../../src/backend/services/jarvis-md.js';

describe('jarvis-md service', () => {
  it('returns the trimmed content when JARVIS.md exists', async () => {
    const content = await loadJarvisMd(async () => '  # My project\n\nSome instructions.  \n');
    expect(content).toBe('# My project\n\nSome instructions.');
  });

  it('returns an empty string when the file read fails (absent)', async () => {
    const content = await loadJarvisMd(async () => {
      throw new Error('Fichier introuvable: JARVIS.md');
    });
    expect(content).toBe('');
  });

  it('renders a PROJECT INSTRUCTIONS block when content is present', () => {
    const text = renderJarvisMd('# Build\nnpm run build');
    expect(text).toContain('PROJECT INSTRUCTIONS (JARVIS.md):');
    expect(text).toContain('# Build\nnpm run build');
  });

  it('renders an empty string for blank/absent content', () => {
    expect(renderJarvisMd('')).toBe('');
    expect(renderJarvisMd('   \n  ')).toBe('');
  });
});
