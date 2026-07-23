/**
 * Jarvis CLI design language — the extension's "Iron Man" red + gold accents
 * (src/frontend/styles/tokens.css) mapped to the terminal.
 *
 * The brand colors are true-color hex, reproduced exactly with 24-bit ANSI when
 * the terminal supports it; otherwise we fall back to the nearest basic ANSI color
 * so the CLI still reads as Jarvis on a 16-color terminal.
 */
import pc from 'picocolors';

/** Brand tokens (hex → rgb), straight from tokens.css / vscode-theme.css. */
export const BRAND = {
  accent: [193, 39, 45] as const, // #c1272d — Iron Man red
  accentHover: [217, 54, 60] as const, // #d9363c
  accentFg: [255, 255, 255] as const, // #ffffff — text on red
  gold: [232, 184, 75] as const, // #e8b84b — secondary gold
  goldHover: [242, 201, 104] as const, // #f2c968
  onGold: [36, 26, 5] as const, // #241a05 — text on gold
  bannerBg: [30, 27, 46] as const, // #1E1B2E — gallery banner
  green: [63, 185, 80] as const, // #3fb950 — connected / success
  blue: [64, 152, 215] as const // #4098d7 — attention / info
};

type RGB = readonly [number, number, number];

/** 24-bit color is available on most modern terminals (VS Code, Windows Terminal, iTerm…). */
const truecolor =
  pc.isColorSupported &&
  (process.env.COLORTERM === 'truecolor' ||
    process.env.COLORTERM === '24bit' ||
    process.env.WT_SESSION !== undefined || // Windows Terminal
    process.env.TERM_PROGRAM === 'vscode');

function fg([r, g, b]: RGB): (s: string) => string {
  if (!pc.isColorSupported) return s => s;
  if (truecolor) return s => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
  // Fallback: nearest basic ANSI (red-ish → red, gold-ish → yellow, else default).
  if (r > 150 && g < 110 && b < 110) return pc.red;
  if (r > 200 && g > 150 && b < 130) return pc.yellow;
  if (g > 150 && r < 120) return pc.green;
  if (b > 170 && r < 120) return pc.blue;
  return s => s;
}

function bg([r, g, b]: RGB): (s: string) => string {
  if (!pc.isColorSupported) return s => s;
  if (truecolor) return s => `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m`;
  return s => s;
}

/** Foreground helpers in the brand palette. */
export const accent = fg(BRAND.accent);
export const accentHover = fg(BRAND.accentHover);
export const gold = fg(BRAND.gold);
export const goldHover = fg(BRAND.goldHover);
export const green = fg(BRAND.green);
export const blue = fg(BRAND.blue);

/** A gold "pill" (dark text on a gold background), mirroring the extension's primary button. */
export function goldPill(s: string): string {
  return bg(BRAND.gold)(fg(BRAND.onGold)(pc.bold(` ${s} `)));
}

/** Passthroughs so the rest of the CLI needs a single import. */
export const bold = pc.bold;
export const dim = pc.dim;
export const italic = pc.italic;
export const underline = pc.underline;
// The ESC control character is exactly what we need to match to strip ANSI SGR codes.
// eslint-disable-next-line no-control-regex
export const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Small status glyphs used across the CLI. */
export const glyph = {
  ok: () => green('✓'),
  err: () => accent('✗'),
  bullet: () => gold('•'),
  arrow: () => gold('▸'),
  tool: () => gold('⚙'),
  think: () => dim('…'),
  jarvis: () => accent('◆')
};
