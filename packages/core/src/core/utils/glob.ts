/** Converts a simple glob pattern (`*`, `**`, `?`) into an anchored, case-insensitive RegExp. */
export function globToRegex(pattern: string): RegExp {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\?/g, '[^/]')
    .replace(/\*\*\//g, '###GLOBSTARSLASH###')
    .replace(/\*\*/g, '###GLOBSTAR###')
    .replace(/\*/g, '[^/]*')
    .replace(/###GLOBSTARSLASH###/g, '(?:.*/)?')
    .replace(/###GLOBSTAR###/g, '.*');
  return new RegExp(`^${regexStr}$`, 'i');
}
