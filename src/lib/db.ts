import Dexie, { type Table } from "dexie";
import type {
  Attempt,
  Bookmark,
  Note,
  QuestionPatch,
  QuizSession,
  ReviewState,
  ShortAnswerAttempt,
  ShortAnswerBookmark,
  ShortAnswerNote,
  ShortAnswerState,
  StoredEnvelope,
  StoredSnapshot,
} from "@/types/quiz";

export const EMPTY_SNAPSHOT: StoredSnapshot = {
  attempts: [],
  bookmarks: [],
  notes: [],
  patches: [],
  reviewStates: [],
  sessions: [],
  shortAnswerAttempts: [],
  shortAnswerBookmarks: [],
  shortAnswerNotes: [],
  shortAnswerStates: [],
};

export class QuizDatabase extends Dexie {
  attempts!: Table<Attempt, string>;
  bookmarks!: Table<Bookmark, string>;
  notes!: Table<Note, string>;
  patches!: Table<QuestionPatch, string>;
  reviewStates!: Table<ReviewState, string>;
  sessions!: Table<QuizSession, string>;
  shortAnswerAttempts!: Table<ShortAnswerAttempt, string>;
  shortAnswerBookmarks!: Table<ShortAnswerBookmark, string>;
  shortAnswerNotes!: Table<ShortAnswerNote, string>;
  shortAnswerStates!: Table<ShortAnswerState, string>;

  constructor() {
    super("zju-se-quiz");
    this.version(1).stores({
      attempts: "id, sessionId, questionId, chapter, answeredAt, isCorrect, mode",
      bookmarks: "questionId, createdAt",
      notes: "questionId, updatedAt",
      patches: "questionId, updatedAt",
      reviewStates: "questionId, status, wrongCount, lastAnsweredAt",
      sessions: "id, mode, startedAt, finishedAt",
    });
    this.version(2).stores({
      attempts: "id, sessionId, questionId, chapter, answeredAt, isCorrect, mode",
      bookmarks: "questionId, createdAt",
      notes: "questionId, updatedAt",
      patches: "questionId, updatedAt",
      reviewStates: "questionId, status, wrongCount, lastAnsweredAt",
      sessions: "id, mode, startedAt, finishedAt",
      shortAnswerAttempts: "id, cardId, answeredAt, rating",
      shortAnswerBookmarks: "cardId, createdAt",
      shortAnswerNotes: "cardId, updatedAt",
      shortAnswerStates: "cardId, status, lastAnsweredAt",
    });
  }
}

let dbInstance: QuizDatabase | null = null;

export function getDb() {
  if (!dbInstance) dbInstance = new QuizDatabase();
  return dbInstance;
}

export async function getSnapshot() {
  const db = getDb();
  const [attempts, bookmarks, notes, patches, reviewStates, sessions, shortAnswerAttempts, shortAnswerBookmarks, shortAnswerNotes, shortAnswerStates] = await Promise.all([
    db.attempts.toArray(),
    db.bookmarks.toArray(),
    db.notes.toArray(),
    db.patches.toArray(),
    db.reviewStates.toArray(),
    db.sessions.toArray(),
    db.shortAnswerAttempts.toArray(),
    db.shortAnswerBookmarks.toArray(),
    db.shortAnswerNotes.toArray(),
    db.shortAnswerStates.toArray(),
  ]);
  return { attempts, bookmarks, notes, patches, reviewStates, sessions, shortAnswerAttempts, shortAnswerBookmarks, shortAnswerNotes, shortAnswerStates };
}

export function normalizeStoredSnapshot(snapshot?: Partial<StoredSnapshot> | null): StoredSnapshot {
  return {
    attempts: Array.isArray(snapshot?.attempts) ? snapshot.attempts : [],
    bookmarks: Array.isArray(snapshot?.bookmarks) ? snapshot.bookmarks : [],
    notes: Array.isArray(snapshot?.notes) ? snapshot.notes : [],
    patches: Array.isArray(snapshot?.patches) ? snapshot.patches : [],
    reviewStates: Array.isArray(snapshot?.reviewStates) ? snapshot.reviewStates : [],
    sessions: Array.isArray(snapshot?.sessions) ? snapshot.sessions : [],
    shortAnswerAttempts: Array.isArray(snapshot?.shortAnswerAttempts) ? snapshot.shortAnswerAttempts : [],
    shortAnswerBookmarks: Array.isArray(snapshot?.shortAnswerBookmarks) ? snapshot.shortAnswerBookmarks : [],
    shortAnswerNotes: Array.isArray(snapshot?.shortAnswerNotes) ? snapshot.shortAnswerNotes : [],
    shortAnswerStates: Array.isArray(snapshot?.shortAnswerStates) ? snapshot.shortAnswerStates : [],
  };
}

export function hasSnapshotContent(snapshot: StoredSnapshot) {
  return (
    snapshot.attempts.length > 0 ||
    snapshot.bookmarks.length > 0 ||
    snapshot.notes.length > 0 ||
    snapshot.patches.length > 0 ||
    snapshot.reviewStates.length > 0 ||
    snapshot.sessions.length > 0 ||
    snapshot.shortAnswerAttempts.length > 0 ||
    snapshot.shortAnswerBookmarks.length > 0 ||
    snapshot.shortAnswerNotes.length > 0 ||
    snapshot.shortAnswerStates.length > 0
  );
}

export async function replaceSnapshot(snapshot: Partial<StoredSnapshot>) {
  const data = normalizeStoredSnapshot(snapshot);
  const db = getDb();
  await db.transaction(
    "rw",
    [
      db.attempts,
      db.bookmarks,
      db.notes,
      db.patches,
      db.reviewStates,
      db.sessions,
      db.shortAnswerAttempts,
      db.shortAnswerBookmarks,
      db.shortAnswerNotes,
      db.shortAnswerStates,
    ],
    async () => {
    await Promise.all([
      db.attempts.clear(),
      db.bookmarks.clear(),
      db.notes.clear(),
      db.patches.clear(),
      db.reviewStates.clear(),
      db.sessions.clear(),
      db.shortAnswerAttempts.clear(),
      db.shortAnswerBookmarks.clear(),
      db.shortAnswerNotes.clear(),
      db.shortAnswerStates.clear(),
    ]);
    if (data.attempts.length) await db.attempts.bulkPut(data.attempts);
    if (data.bookmarks.length) await db.bookmarks.bulkPut(data.bookmarks);
    if (data.notes.length) await db.notes.bulkPut(data.notes);
    if (data.patches.length) await db.patches.bulkPut(data.patches);
    if (data.reviewStates.length) await db.reviewStates.bulkPut(data.reviewStates);
    if (data.sessions.length) await db.sessions.bulkPut(data.sessions);
    if (data.shortAnswerAttempts.length) await db.shortAnswerAttempts.bulkPut(data.shortAnswerAttempts);
    if (data.shortAnswerBookmarks.length) await db.shortAnswerBookmarks.bulkPut(data.shortAnswerBookmarks);
    if (data.shortAnswerNotes.length) await db.shortAnswerNotes.bulkPut(data.shortAnswerNotes);
    if (data.shortAnswerStates.length) await db.shortAnswerStates.bulkPut(data.shortAnswerStates);
    },
  );
}

export async function fetchDiskSnapshot() {
  try {
    const response = await fetch("/api/local-store", { cache: "no-store" });
    if (!response.ok) return null;
    const envelope = (await response.json()) as Partial<StoredEnvelope> & { exists?: boolean };
    if (!envelope.exists || !envelope.data) return null;
    return normalizeStoredSnapshot(envelope.data);
  } catch {
    return null;
  }
}

export async function syncSnapshotToDisk(snapshot?: StoredSnapshot) {
  try {
    const data = snapshot || (await getSnapshot());
    const response = await fetch("/api/local-store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: 1,
        updatedAt: new Date().toISOString(),
        data,
      } satisfies StoredEnvelope),
    });
    return response.ok;
  } catch {
    return false;
  }
}
