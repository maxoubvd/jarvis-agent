/**
 * Registre partagé des commandes `/` et mentions `@` proposées par
 * l'autocomplétion du chat. Reflète le routage backend (extension.ts).
 */

export type TriggerChar = '/' | '@';

export interface CommandItem {
  trigger: TriggerChar;
  /** Texte inséré à l'acceptation (avec espace/`:` final si pertinent). */
  insert: string;
  /** Libellé affiché. */
  label: string;
  /** Courte description affichée à droite. */
  detail: string;
}

export const SLASH_COMMANDS: CommandItem[] = [
  { trigger: '/', insert: '/new ', label: '/new', detail: 'Nouvelle discussion' },
  { trigger: '/', insert: '/resume ', label: '/resume', detail: 'Reprendre une ancienne discussion' },
  { trigger: '/', insert: '/agent ', label: '/agent', detail: 'Agentic mode on a task' },
  { trigger: '/', insert: '/tdd ', label: '/tdd', detail: 'Auto-TDD loop' },
  { trigger: '/', insert: '/workflow ', label: '/workflow', detail: 'Run a predefined workflow' },
  { trigger: '/', insert: '/rollback', label: '/rollback', detail: 'Annuler les modifications depuis le dernier message' },
  { trigger: '/', insert: '/init', label: '/init', detail: 'Initialize project (git init + generate JARVIS.md)' }
];

export const AT_MENTIONS: CommandItem[] = [
  { trigger: '@', insert: '@file:', label: '@file:', detail: 'Add a file to context' },
  { trigger: '@', insert: '@docs:', label: '@docs:', detail: 'Search the indexed docs' },
  { trigger: '@', insert: '@read ', label: '@read', detail: 'Read a file (no model)' },
  { trigger: '@', insert: '@list ', label: '@list', detail: 'List a directory (no model)' },
  { trigger: '@', insert: '@write ', label: '@write', detail: 'Write a file (no model)' },
  { trigger: '@', insert: '@run ', label: '@run', detail: 'Run a terminal command (no model)' },
  { trigger: '@', insert: '@QA-Agent ', label: '@QA-Agent', detail: 'Quality agent' },
  { trigger: '@', insert: '@Doc-Agent ', label: '@Doc-Agent', detail: 'Documentation agent' },
  { trigger: '@', insert: '@Refactor-Agent ', label: '@Refactor-Agent', detail: 'Refactoring agent' },
  { trigger: '@', insert: '@Security-Agent ', label: '@Security-Agent', detail: 'Security agent' },
  { trigger: '@', insert: '@Perf-Agent ', label: '@Perf-Agent', detail: 'Performance agent' }
];

export interface TriggerMatch {
  trigger: TriggerChar;
  /** Index du caractère déclencheur dans le texte. */
  tokenStart: number;
  /** Texte saisi après le déclencheur, jusqu'au caret. */
  partial: string;
}

function isWhitespace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

/**
 * Détecte si le caret se trouve dans un token déclenché par `/` ou `@`.
 * - `/` n'est actif qu'en tout début de saisie (commande).
 * - `@` est actif en début de saisie ou après une espace.
 * Retourne `null` si le token courant contient une espace (token terminé).
 */
export function matchTrigger(text: string, caret: number): TriggerMatch | null {
  let i = caret - 1;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '/' || ch === '@') {
      const atStart = i === 0;
      const afterSpace = i > 0 && isWhitespace(text[i - 1]);
      if (ch === '/' && !atStart) return null;
      if (ch === '@' && !(atStart || afterSpace)) return null;
      return { trigger: ch, tokenStart: i, partial: text.slice(i + 1, caret) };
    }
    if (isWhitespace(ch)) return null;
    i--;
  }
  return null;
}

/**
 * Items du registre correspondant au token en cours (préfixe insensible à la
 * casse). `extra` permet d'injecter des items dynamiques (agents/workflows
 * envoyés par le backend via le message `capabilities`).
 */
export function filterCommands(match: TriggerMatch, extra: CommandItem[] = []): CommandItem[] {
  const statics = match.trigger === '/' ? SLASH_COMMANDS : AT_MENTIONS;
  const dynamics = extra.filter(c => c.trigger === match.trigger);
  // Les items dynamiques remplacent un éventuel doublon statique (même insert).
  const seen = new Set(dynamics.map(c => c.insert));
  const pool = [...dynamics, ...statics.filter(c => !seen.has(c.insert))];
  const query = (match.trigger + match.partial).toLowerCase();
  return pool.filter(
    c => c.insert.toLowerCase().startsWith(query) || c.label.toLowerCase().startsWith(query)
  );
}
