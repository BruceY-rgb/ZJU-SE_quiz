import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { StoredEnvelope, StoredSnapshot } from "@/types/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORE_DIR = path.join(process.cwd(), ".quiz-data");
const STORE_FILE = path.join(STORE_DIR, "local-store.json");

const EMPTY_SNAPSHOT: StoredSnapshot = {
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

function normalizeSnapshot(snapshot?: Partial<StoredSnapshot> | null): StoredSnapshot {
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

export async function GET() {
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredEnvelope>;
    return NextResponse.json({
      exists: true,
      schemaVersion: 1,
      updatedAt: parsed.updatedAt || new Date(0).toISOString(),
      data: normalizeSnapshot(parsed.data),
      path: STORE_FILE,
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return NextResponse.json({
        exists: false,
        schemaVersion: 1,
        updatedAt: null,
        data: EMPTY_SNAPSHOT,
        path: STORE_FILE,
      });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "读取本地数据库失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<StoredEnvelope>;
    const envelope: StoredEnvelope = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      data: normalizeSnapshot(body.data),
    };
    await mkdir(STORE_DIR, { recursive: true });
    const tempFile = `${STORE_FILE}.${Date.now()}.tmp`;
    await writeFile(tempFile, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    await rename(tempFile, STORE_FILE);
    return NextResponse.json({ ok: true, path: STORE_FILE, ...envelope });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "写入本地数据库失败" }, { status: 500 });
  }
}
