import { describe, it, expect } from 'vitest';
import { BRAND, strip, goldPill, glyph } from '../src/theme.js';

describe('CLI theme (design language)', () => {
  it('carries the extension brand colors (tokens.css)', () => {
    // #c1272d red + #e8b84b gold — the exact hexes from src/frontend/styles/tokens.css.
    expect(BRAND.accent).toEqual([193, 39, 45]);
    expect(BRAND.gold).toEqual([232, 184, 75]);
    expect(BRAND.onGold).toEqual([36, 26, 5]);
  });

  it('strip() removes ANSI escape codes', () => {
    const colored = '\x1b[38;2;193;39;45mred\x1b[39m';
    expect(strip(colored)).toBe('red');
  });

  it('goldPill wraps the given text', () => {
    expect(strip(goldPill('DEFAULT'))).toContain('DEFAULT');
  });

  it('glyphs render to non-empty strings', () => {
    expect(strip(glyph.ok())).toBeTruthy();
    expect(strip(glyph.jarvis())).toBeTruthy();
    expect(strip(glyph.tool())).toBeTruthy();
  });
});
