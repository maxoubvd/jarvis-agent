/**
 * Diff ligne à ligne (LCS) pour la revue des modifications IA (façon
 * Antigravity) : les changements sont regroupés en hunks que l'utilisateur
 * accepte (intégré à la base) ou rejette (retiré du fichier) individuellement.
 */

export interface DiffHunk {
  /** Index du hunk dans le diff courant — recalculé après chaque résolution. */
  id: number;
  /** Première ligne concernée côté « avant » (1-indexée). */
  beforeStart: number;
  /** Première ligne concernée côté « après » (1-indexée). */
  afterStart: number;
  /** Lignes supprimées (rouge). */
  beforeLines: string[];
  /** Lignes ajoutées (vert). */
  afterLines: string[];
  /** Jusqu'à 2 lignes de contexte avant/après, pour l'affichage. */
  contextBefore: string[];
  contextAfter: string[];
}

type Op = { type: 'equal' | 'del' | 'add'; line: string };

const CONTEXT_LINES = 2;
/** Au-delà, le LCS O(n·m) devient coûteux — on retombe sur un hunk unique. */
const MAX_LCS_LINES = 3000;

function splitLines(text: string): string[] {
  return text.split('\n');
}

/** Ops du diff entre deux textes (préfixe/suffixe communs éliminés avant LCS). */
export function computeLineOps(before: string, after: string): Op[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);

  const ops: Op[] = a.slice(0, prefix).map(line => ({ type: 'equal' as const, line }));

  if (midA.length === 0 || midB.length === 0 || midA.length * midB.length > MAX_LCS_LINES * MAX_LCS_LINES) {
    ops.push(...midA.map(line => ({ type: 'del' as const, line })));
    ops.push(...midB.map(line => ({ type: 'add' as const, line })));
  } else {
    // LCS classique par programmation dynamique sur la zone modifiée.
    const rows = midA.length + 1;
    const cols = midB.length + 1;
    const table = new Uint32Array(rows * cols);
    for (let i = midA.length - 1; i >= 0; i--) {
      for (let j = midB.length - 1; j >= 0; j--) {
        table[i * cols + j] =
          midA[i] === midB[j]
            ? table[(i + 1) * cols + j + 1] + 1
            : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < midA.length && j < midB.length) {
      if (midA[i] === midB[j]) {
        ops.push({ type: 'equal', line: midA[i] });
        i++;
        j++;
      } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
        ops.push({ type: 'del', line: midA[i] });
        i++;
      } else {
        ops.push({ type: 'add', line: midB[j] });
        j++;
      }
    }
    while (i < midA.length) ops.push({ type: 'del', line: midA[i++] });
    while (j < midB.length) ops.push({ type: 'add', line: midB[j++] });
  }

  ops.push(...a.slice(a.length - suffix).map(line => ({ type: 'equal' as const, line })));
  return ops;
}

/** Regroupe les ops non-equal contigus en hunks numérotés. */
export function computeHunks(before: string, after: string): DiffHunk[] {
  const ops = computeLineOps(before, after);
  const hunks: DiffHunk[] = [];
  let beforeLine = 1;
  let afterLine = 1;
  let index = 0;

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === 'equal') {
      beforeLine++;
      afterLine++;
      continue;
    }
    const start = i;
    const beforeStart = beforeLine;
    const afterStart = afterLine;
    const beforeLines: string[] = [];
    const afterLines: string[] = [];
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'del') {
        beforeLines.push(ops[i].line);
        beforeLine++;
      } else {
        afterLines.push(ops[i].line);
        afterLine++;
      }
      i++;
    }
    const contextBefore = ops
      .slice(Math.max(0, start - CONTEXT_LINES), start)
      .filter(o => o.type === 'equal')
      .map(o => o.line);
    const contextAfter = ops
      .slice(i, i + CONTEXT_LINES)
      .filter(o => o.type === 'equal')
      .map(o => o.line);
    hunks.push({ id: index++, beforeStart, afterStart, beforeLines, afterLines, contextBefore, contextAfter });
    i--; // la boucle for ré-incrémente
  }
  return hunks;
}

/**
 * Reconstruit un texte en résolvant UN hunk :
 * - `accept` : le hunk est intégré à la base → nouveau « before » (le fichier ne bouge pas) ;
 * - `reject` : le hunk est annulé dans le fichier → nouveau « after » (à écrire sur disque).
 * Les autres hunks restent en attente.
 */
export function resolveHunk(
  before: string,
  after: string,
  hunkId: number,
  action: 'accept' | 'reject'
): { before: string; after: string } {
  const ops = computeLineOps(before, after);
  const newBefore: string[] = [];
  const newAfter: string[] = [];
  let index = -1;
  let inHunk = false;

  for (const op of ops) {
    if (op.type === 'equal') {
      inHunk = false;
      newBefore.push(op.line);
      newAfter.push(op.line);
      continue;
    }
    if (!inHunk) {
      inHunk = true;
      index++;
    }
    const resolved = index === hunkId;
    if (op.type === 'del') {
      // accept : la suppression devient la base ; reject : la ligne revient dans le fichier.
      if (!(resolved && action === 'accept')) newBefore.push(op.line);
      if (resolved && action === 'reject') newAfter.push(op.line);
    } else {
      // add — accept : la ligne entre dans la base ; reject : elle sort du fichier.
      if (resolved && action === 'accept') newBefore.push(op.line);
      if (!(resolved && action === 'reject')) newAfter.push(op.line);
    }
  }

  return { before: newBefore.join('\n'), after: newAfter.join('\n') };
}
