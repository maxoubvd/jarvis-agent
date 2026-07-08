import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ChatMessage } from '../models/abstract.js';

/**
 * Sessions de discussion persistées (`/new`, `/resume`) : les 5 dernières
 * discussions sont conservées dans `.vscode/jarvis-sessions.json` (même
 * pattern qu'analytics.ts). La session courante (index 0) est un miroir de
 * l'historique du chat, réécrite après chaque échange complet.
 * Pas d'import vscode : le chemin du fichier est injecté (testable).
 */

export interface DiscussionSession {
  id: string;
  /** Premier message utilisateur, tronqué — affiché dans le picker de /resume. */
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface SessionsFile {
  version: '1.0';
  /** Index 0 = session courante, puis de la plus récente à la plus ancienne. */
  sessions: DiscussionSession[];
}

export const MAX_SESSIONS = 5;
const TITLE_MAX_CHARS = 60;
/** Borne la taille du JSON : chaque message est tronqué à la sauvegarde. */
const MAX_MESSAGE_CHARS = 8_000;
/** Borne le contexte injecté au /resume (~1k tokens). */
const MAX_CONTEXT_CHARS = 4_000;

function newSession(title = ''): DiscussionSession {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, messages: [] };
}

export class SessionStore {
  private data: SessionsFile;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  private load(): SessionsFile {
    try {
      if (fsSync.existsSync(this.filePath)) {
        const parsed = JSON.parse(fsSync.readFileSync(this.filePath, 'utf-8')) as SessionsFile;
        if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
          return { version: '1.0', sessions: parsed.sessions.slice(0, MAX_SESSIONS) };
        }
      }
    } catch {
      // JSON corrompu/illisible → store neuf
    }
    return { version: '1.0', sessions: [newSession()] };
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {
      // Non-fatal — la persistance ne doit jamais casser le chat
    }
  }

  public getCurrent(): DiscussionSession {
    return this.data.sessions[0];
  }

  /** Réécrit la session courante depuis l'historique du chat, puis persiste. */
  public updateCurrent(messages: ChatMessage[]): void {
    const current = this.getCurrent();
    current.messages = messages.map(m => ({
      role: m.role,
      content: m.content.length > MAX_MESSAGE_CHARS ? m.content.slice(0, MAX_MESSAGE_CHARS) + '…' : m.content
    }));
    const firstUser = current.messages.find(m => m.role === 'user');
    if (!current.title && firstUser) {
      current.title = firstUser.content.slice(0, TITLE_MAX_CHARS);
    }
    current.updatedAt = new Date().toISOString();
    void this.save();
  }

  /** Démarre une nouvelle session courante (réutilise la courante si vide). */
  public startNew(title?: string): DiscussionSession {
    const current = this.getCurrent();
    if (current.messages.length === 0) {
      if (title) current.title = title;
      return current;
    }
    const session = newSession(title);
    this.data.sessions.unshift(session);
    this.data.sessions = this.data.sessions.slice(0, MAX_SESSIONS);
    void this.save();
    return session;
  }

  /** Discussions précédentes non vides (hors courante), plus récentes d'abord. */
  public list(): SessionSummary[] {
    return this.data.sessions
      .slice(1)
      .filter(s => s.messages.length > 0)
      .map(s => ({
        id: s.id,
        title: s.title || '(untitled)',
        updatedAt: s.updatedAt,
        messageCount: s.messages.length
      }));
  }

  public getById(id: string): DiscussionSession | null {
    return this.data.sessions.find(s => s.id === id) ?? null;
  }
}

/**
 * Condense une discussion passée en UN message system injecté dans l'historique
 * au /resume : un seul slot dans la fenêtre agent (slice(-10)), pas de problème
 * d'alternance de rôles, taille bornée (la fin du transcript est conservée).
 */
export function buildResumeContext(session: DiscussionSession): ChatMessage {
  const turns = session.messages
    .filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');
  const clipped =
    turns.length > MAX_CONTEXT_CHARS ? '[…]\n' + turns.slice(turns.length - MAX_CONTEXT_CHARS) : turns;
  const date = session.updatedAt.slice(0, 10);
  return {
    role: 'system',
    content: `Resumed discussion "${session.title}" (from ${date}). Previous conversation:\n\n${clipped}`
  };
}
