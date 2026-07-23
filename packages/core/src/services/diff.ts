/**
 * Line-by-line diff (LCS) for AI change review (Antigravity-style): changes
 * are grouped into hunks that the user accepts (merged into the baseline)
 * or rejects (removed from the file) individually.
 */

export interface DiffHunk {
  /** Index of the hunk in the current diff — recomputed after each resolution. */
  id: number;
  /** First affected line on the "before" side (1-indexed). */
  beforeStart: number;
  /** First affected line on the "after" side (1-indexed). */
  afterStart: number;
  /** Removed lines (red). */
  beforeLines: string[];
  /** Added lines (green). */
  afterLines: string[];
  /** Up to 2 lines of context before/after, for display. */
  contextBefore: string[];
  contextAfter: string[];
}

type Op = { type: 'equal' | 'del' | 'add'; line: string };

const CONTEXT_LINES = 2;
/** Beyond this, O(n·m) LCS becomes expensive — we fall back to a single hunk. */
const MAX_LCS_LINES = 3000;

function splitLines(text: string): string[] {
  return text.split('\n');
}

/** Diff ops between two texts (common prefix/suffix stripped before LCS). */
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
    // Classic dynamic-programming LCS over the modified region.
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

/** Groups contiguous non-equal ops into numbered hunks. */
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
    i--; // the for loop re-increments
  }
  return hunks;
}

/**
 * Rebuilds a text by resolving ONE hunk:
 * - `accept`: the hunk is merged into the baseline → new "before" (the file doesn't change);
 * - `reject`: the hunk is undone in the file → new "after" (to write to disk).
 * The other hunks remain pending.
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
      // accept: the deletion becomes the baseline; reject: the line comes back into the file.
      if (!(resolved && action === 'accept')) newBefore.push(op.line);
      if (resolved && action === 'reject') newAfter.push(op.line);
    } else {
      // add — accept: the line enters the baseline; reject: it leaves the file.
      if (resolved && action === 'accept') newBefore.push(op.line);
      if (!(resolved && action === 'reject')) newAfter.push(op.line);
    }
  }

  return { before: newBefore.join('\n'), after: newAfter.join('\n') };
}
