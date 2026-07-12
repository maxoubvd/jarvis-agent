import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ChatMessage } from '../models/abstract.js';

/**
 * Persisted chat sessions (`/new`, `/resume`): the 5 most recent
 * conversations are stored in `.vscode/jarvis-sessions.json` (same
 * pattern as analytics.ts). The current session (index 0) is a mirror of
 * the chat history, rewritten after each complete exchange.
 * No vscode import: the file path is injected (testable).
 */

export interface DiscussionSession {
  id: string;
  /** First user message, truncated — shown in the /resume picker. */
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
  /** Index 0 = current session, then most-recent to oldest. */
  sessions: DiscussionSession[];
}

export const MAX_SESSIONS = 5;
const TITLE_MAX_CHARS = 60;
/** Caps the JSON size: each message is truncated on save. */
const MAX_MESSAGE_CHARS = 8_000;
/** Caps the context injected at /resume (~1k tokens). */
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
      // corrupted/unreadable JSON — start fresh
    }
    return { version: '1.0', sessions: [newSession()] };
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch {
      // Non-fatal — persistence must never break the chat
    }
  }

  public getCurrent(): DiscussionSession {
    return this.data.sessions[0];
  }

  /** Rewrites the current session from the chat history, then persists. */
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

  /** Starts a new current session (reuses the current one if empty). */
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

  /** Previous non-empty conversations (excluding current), most recent first. */
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
 * Condenses a past conversation into ONE system message injected into the history
 * at /resume: a single slot in the agent window (slice(-10)), no role-alternation
 * issue, bounded size (the end of the transcript is kept).
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
