/** Conversion d'un pattern glob simple (`*`, `**`, `?`) en RegExp ancrée, insensible à la casse. */
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
