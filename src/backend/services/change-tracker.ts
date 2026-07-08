import { computeHunks, resolveHunk, type DiffHunk } from './diff.js';

/** Vue d'un fichier en attente de revue, envoyée au webview. */
export interface PendingFileView {
  path: string;
  /** true = fichier créé par l'IA (rejet du fichier = suppression). */
  isNew: boolean;
  /** Incrémenté à chaque évolution — les résolutions périmées sont ignorées. */
  revision: number;
  hunks: DiffHunk[];
}

interface PendingFile {
  path: string;
  /** Contenu de référence (accepté). `null` = le fichier n'existait pas. */
  before: string | null;
  /** Contenu courant sur disque. */
  after: string;
  revision: number;
}

/** Action disque que l'appelant doit exécuter après une résolution. */
export interface DiskAction {
  path: string;
  /** `null` = supprimer le fichier (rejet d'une création). */
  content: string | null;
}

/**
 * Suivi des modifications IA pour la revue de diffs (façon Antigravity) :
 * les écritures sont appliquées immédiatement puis revues — accepter un hunk
 * l'intègre à la base de référence, le rejeter réécrit le fichier sans lui.
 * La classe est pure (aucune I/O) : les écritures disque nécessaires sont
 * retournées à l'appelant sous forme de {@link DiskAction}.
 */
export class ChangeTracker {
  private files = new Map<string, PendingFile>();
  /** true pendant l'application d'une résolution : nos propres écritures ne sont pas re-suivies. */
  private applying = false;

  /** Enregistre une écriture de l'IA (appelé par le listener fileSystem). */
  public record(path: string, before: string | null, after: string): void {
    if (this.applying) return;
    const existing = this.files.get(path);
    if (existing) {
      existing.after = after;
      existing.revision++;
      // Retour au contenu de référence → plus rien à revoir.
      if (existing.before !== null && existing.before === after) this.files.delete(path);
      return;
    }
    if (before !== null && before === after) return;
    this.files.set(path, { path, before, after, revision: 1 });
  }

  /** Exécute `fn` sans suivre les écritures qu'elle déclenche. */
  public async runUntracked<T>(fn: () => Promise<T>): Promise<T> {
    this.applying = true;
    try {
      return await fn();
    } finally {
      this.applying = false;
    }
  }

  public get pendingCount(): number {
    return this.files.size;
  }

  /** Contenu de référence courant d'un fichier en revue (`''` si créé par l'IA), `null` si non suivi. */
  public getBaseline(path: string): string | null {
    const file = this.files.get(path);
    if (!file) return null;
    return file.before ?? '';
  }

  /** true si le fichier est en attente de revue. */
  public isPending(path: string): boolean {
    return this.files.has(path);
  }

  public snapshot(): PendingFileView[] {
    return [...this.files.values()].map(f => ({
      path: f.path,
      isNew: f.before === null,
      revision: f.revision,
      hunks: computeHunks(f.before ?? '', f.after)
    }));
  }

  /**
   * Résout un hunk. Retourne l'action disque à appliquer (rejet) ou `null`
   * (acceptation, ou résolution périmée/inconnue — rien à faire).
   */
  public resolveHunk(
    path: string,
    hunkId: number,
    revision: number,
    action: 'accept' | 'reject'
  ): DiskAction | null {
    const file = this.files.get(path);
    if (!file || file.revision !== revision) return null;

    const resolved = resolveHunk(file.before ?? '', file.after, hunkId, action);
    file.before = resolved.before;
    file.after = resolved.after;
    file.revision++;
    if (file.before === file.after) this.files.delete(path);

    return action === 'reject' ? { path, content: resolved.after } : null;
  }

  /** Résout un fichier entier. Rejet d'une création = suppression du fichier. */
  public resolveFile(path: string, action: 'accept' | 'reject'): DiskAction | null {
    const file = this.files.get(path);
    if (!file) return null;
    this.files.delete(path);
    if (action === 'accept') return null;
    return { path, content: file.before };
  }

  /** Résout tout. Retourne les actions disque des rejets. */
  public resolveAll(action: 'accept' | 'reject'): DiskAction[] {
    const actions: DiskAction[] = [];
    for (const path of [...this.files.keys()]) {
      const diskAction = this.resolveFile(path, action);
      if (diskAction) actions.push(diskAction);
    }
    return actions;
  }
}
