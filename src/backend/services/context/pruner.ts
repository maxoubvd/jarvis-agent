/**
 * Context Pruning (spec §8.3) : n'envoyer au modèle que les parties
 * pertinentes d'un fichier. Implémentation légère à base d'analyse
 * structurelle par indentation/accolades (sans tree-sitter).
 */

export type PruneLevel = 'none' | 'function' | 'class' | 'module';

export interface PruneOptions {
  level: PruneLevel;
  /** Nom du symbole (fonction/classe) à conserver en entier. */
  symbol?: string;
}

interface CodeBlock {
  name: string;
  kind: 'function' | 'class';
  startLine: number;
  endLine: number;
}

const IMPORT_REGEX = /^\s*(import\s|from\s+\S+\s+import|const\s+\w+\s*=\s*require\(|using\s|#include\s)/;

const DECLARATION_PATTERNS: Array<{ kind: 'function' | 'class'; regex: RegExp }> = [
  { kind: 'class', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  { kind: 'function', regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/ },
  { kind: 'function', regex: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/ },
  { kind: 'function', regex: /^\s*def\s+([A-Za-z_]\w*)/ }
];

/** Trouve la fin d'un bloc par équilibre d'accolades (ou dé-indentation pour Python). */
function findBlockEnd(lines: string[], startLine: number): number {
  const startText = lines[startLine];
  const usesBraces = /\{\s*$/.test(startText) || startText.includes('{') ||
    (startLine + 1 < lines.length && lines[startLine + 1].trim() === '{');

  if (usesBraces) {
    let depth = 0;
    let seenOpen = false;
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') {
          depth++;
          seenOpen = true;
        } else if (ch === '}') {
          depth--;
        }
      }
      if (seenOpen && depth <= 0) return i;
    }
    return lines.length - 1;
  }

  // Style indentation (Python)
  const baseIndent = startText.match(/^\s*/)?.[0].length ?? 0;
  let lastNonEmpty = startLine;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= baseIndent) return lastNonEmpty;
    lastNonEmpty = i;
  }
  return lastNonEmpty;
}

export function extractBlocks(content: string): CodeBlock[] {
  const lines = content.split('\n');
  const blocks: CodeBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const { kind, regex } of DECLARATION_PATTERNS) {
      const match = lines[i].match(regex);
      if (match) {
        blocks.push({ name: match[1], kind, startLine: i, endLine: findBlockEnd(lines, i) });
        break;
      }
    }
  }
  return blocks;
}

function extractImports(lines: string[]): string[] {
  return lines.filter(l => IMPORT_REGEX.test(l));
}

/**
 * Élagage du contexte :
 * - `function` : imports + le bloc contenant/nommé `symbol`, signatures du reste
 * - `class`    : imports + la classe ciblée entière
 * - `module`   : fichier sans commentaires ni lignes vides
 * - `none`     : fichier complet
 */
export function pruneContext(content: string, options: PruneOptions): string {
  if (options.level === 'none') return content;

  const lines = content.split('\n');

  if (options.level === 'module') {
    return lines
      .filter(l => l.trim() && !/^\s*(\/\/|\/\*|\*|#(?!include)|<!--)/.test(l))
      .join('\n');
  }

  const blocks = extractBlocks(content);
  const wantedKind = options.level === 'class' ? 'class' : 'function';
  const target = options.symbol
    ? blocks.find(b => b.name === options.symbol) ??
      blocks.find(b => b.name.toLowerCase() === options.symbol?.toLowerCase())
    : blocks.find(b => b.kind === wantedKind);

  if (!target) {
    // Symbole introuvable → repli sur le module élagué
    return pruneContext(content, { level: 'module' });
  }

  const parts: string[] = [];
  const imports = extractImports(lines);
  if (imports.length > 0) {
    parts.push(imports.join('\n'));
  }

  // Signatures des autres blocs de premier niveau pour garder la carte du fichier
  const signatures = blocks
    .filter(b => b !== target && (b.startLine < target.startLine || b.startLine > target.endLine))
    .map(b => `${lines[b.startLine].trim()} … // lignes ${b.startLine + 1}-${b.endLine + 1}`);
  if (signatures.length > 0) {
    parts.push('// Autres définitions du fichier:\n' + signatures.join('\n'));
  }

  parts.push(lines.slice(target.startLine, target.endLine + 1).join('\n'));
  return parts.join('\n\n');
}

/** Choix automatique de stratégie selon la taille et le budget de tokens. */
export function choosePruneLevel(contentChars: number, budgetTokens: number): PruneLevel {
  const estimatedTokens = Math.ceil(contentChars / 4);
  if (estimatedTokens <= budgetTokens * 0.25) return 'none';
  if (estimatedTokens <= budgetTokens * 0.5) return 'module';
  if (estimatedTokens <= budgetTokens) return 'class';
  return 'function';
}
