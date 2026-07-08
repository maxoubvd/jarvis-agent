import Parser from 'web-tree-sitter';
import * as path from 'path';

export type PruneLevel = 'none' | 'function' | 'class' | 'module';

export interface PruneOptions {
  level: PruneLevel;
  /** Nom du symbole (fonction/classe) à conserver en entier. */
  symbol?: string;
  /** Extension du fichier pour déterminer le langage (ex: .ts, .py) */
  fileExtension?: string;
}

interface CodeBlock {
  name: string;
  kind: 'function' | 'class';
  startLine: number;
  endLine: number;
  node: Parser.SyntaxNode;
}

let parserReady = false;
let currentLang = '';

/** Initialise web-tree-sitter si ce n'est pas déjà fait. */
async function ensureParser(extension: string): Promise<Parser | null> {
  if (extension !== '.ts' && extension !== '.js' && extension !== '.tsx' && extension !== '.jsx') {
    // Pour cet exemple, on limite TS/JS. À étendre avec d'autres WASM.
    return null;
  }
  
  try {
    if (!parserReady) {
      await Parser.init();
      parserReady = true;
    }
    const parser = new Parser();
    // En production, il faut packager tree-sitter-typescript.wasm
    // avec l'extension ou le télécharger à la volée.
    const langWasmPath = path.join(__dirname, '..', '..', '..', 'media', 'tree-sitter-typescript.wasm');
    const lang = await Parser.Language.load(langWasmPath);
    parser.setLanguage(lang);
    return parser;
  } catch (err) {
    console.error('Erreur initialisation tree-sitter:', err);
    return null;
  }
}

/** 
 * Extrait les blocs de premier niveau en utilisant l'AST Tree-sitter.
 */
function extractBlocksAST(root: Parser.SyntaxNode): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  
  for (const child of root.children) {
    if (child.type === 'class_declaration' || child.type === 'export_statement' && child.children.some(c => c.type === 'class_declaration')) {
      const classNode = child.type === 'class_declaration' ? child : child.children.find(c => c.type === 'class_declaration')!;
      const nameNode = classNode.childForFieldName('name');
      if (nameNode) {
        blocks.push({
          name: nameNode.text,
          kind: 'class',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          node: child
        });
      }
    } else if (child.type === 'function_declaration' || child.type === 'export_statement' && child.children.some(c => c.type === 'function_declaration')) {
      const fnNode = child.type === 'function_declaration' ? child : child.children.find(c => c.type === 'function_declaration')!;
      const nameNode = fnNode.childForFieldName('name');
      if (nameNode) {
        blocks.push({
          name: nameNode.text,
          kind: 'function',
          startLine: child.startPosition.row,
          endLine: child.endPosition.row,
          node: child
        });
      }
    } else if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      // Pour les arrow functions de premier niveau (const x = () => {})
      const declarator = child.children.find(c => c.type === 'variable_declarator');
      if (declarator) {
        const nameNode = declarator.childForFieldName('name');
        const valueNode = declarator.childForFieldName('value');
        if (nameNode && valueNode && valueNode.type === 'arrow_function') {
          blocks.push({
            name: nameNode.text,
            kind: 'function',
            startLine: child.startPosition.row,
            endLine: child.endPosition.row,
            node: child
          });
        }
      }
    }
  }
  
  return blocks;
}

// Fallback Regex en cas d'absence de Tree-Sitter
const IMPORT_REGEX = /^\s*(import\s|from\s+\S+\s+import|const\s+\w+\s*=\s*require\(|using\s|#include\s)/;
const DECLARATION_PATTERNS = [
  { kind: 'class' as const, regex: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'function' as const, regex: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  { kind: 'function' as const, regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/ },
  { kind: 'function' as const, regex: /^\s*(?:public|private|protected)?\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/ },
  { kind: 'function' as const, regex: /^\s*def\s+([A-Za-z_]\w*)/ }
];

function findBlockEnd(lines: string[], startLine: number): number {
  const startText = lines[startLine];
  const usesBraces = /\{\s*$/.test(startText) || startText.includes('{') ||
    (startLine + 1 < lines.length && lines[startLine + 1].trim() === '{');

  if (usesBraces) {
    let depth = 0;
    let seenOpen = false;
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; seenOpen = true; }
        else if (ch === '}') { depth--; }
      }
      if (seenOpen && depth <= 0) return i;
    }
    return lines.length - 1;
  }
  return startLine; // Fallback simple pour python
}

function extractBlocksRegex(content: string): Omit<CodeBlock, 'node'>[] {
  const lines = content.split('\n');
  const blocks: Omit<CodeBlock, 'node'>[] = [];
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
 * Élagage du contexte via AST Tree-Sitter (ou regex en fallback).
 */
export async function pruneContext(content: string, options: PruneOptions): Promise<string> {
  if (options.level === 'none') return content;

  const lines = content.split('\n');
  if (options.level === 'module') {
    return lines.filter(l => l.trim() && !/^\s*(\/\/|\/\*|\*|#(?!include)|<!--)/.test(l)).join('\n');
  }

  const parser = await ensureParser(options.fileExtension || '.ts');
  
  let blocks: Array<{ name: string; kind: 'function' | 'class'; startLine: number; endLine: number }> = [];
  
  if (parser) {
    const tree = parser.parse(content);
    blocks = extractBlocksAST(tree.rootNode);
  } else {
    blocks = extractBlocksRegex(content);
  }

  const wantedKind = options.level === 'class' ? 'class' : 'function';
  const target = options.symbol
    ? blocks.find(b => b.name === options.symbol) ??
      blocks.find(b => b.name.toLowerCase() === options.symbol?.toLowerCase())
    : blocks.find(b => b.kind === wantedKind);

  if (!target) {
    return pruneContext(content, { level: 'module', fileExtension: options.fileExtension });
  }

  const parts: string[] = [];
  const imports = extractImports(lines);
  if (imports.length > 0) {
    parts.push(imports.join('\n'));
  }

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
