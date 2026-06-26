"use client";

import {
  Archive,
  BookOpen,
  Brain,
  CheckCircle2,
  Download,
  FilePenLine,
  History,
  Library,
  ListFilter,
  NotebookPen,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Star,
  Target,
  Upload,
  XCircle,
} from "lucide-react";
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ShortAnswerWorkspace } from "@/components/ShortAnswerWorkspace";
import {
  EMPTY_SNAPSHOT,
  fetchDiskSnapshot,
  getDb,
  getSnapshot,
  hasSnapshotContent,
  replaceSnapshot,
  syncSnapshotToDisk,
} from "@/lib/db";
import {
  answerToIndexes,
  applyPatch,
  chapterSortValue,
  deriveReviewStatus,
  findQuestionByLegacyItem,
  hasWrongHistory,
  hydrateQuestions,
  isAnswerCorrect,
  normalizeReviewState,
  normalizeAnswer,
  normalizeOption,
  reviewPriority,
  selectedAnswerString,
  type QuestionBank,
} from "@/lib/questions";
import type {
  Attempt,
  Bookmark,
  EffectiveQuestion,
  ImportedLegacyItem,
  Note,
  Question,
  QuestionPatch,
  QuizMode,
  QuizSession,
  ReviewState,
  StoredSnapshot,
} from "@/types/quiz";

type View = "dashboard" | "quiz" | "library" | "history" | "short-answer";
type LibraryScope = "all" | "wrong" | "bookmarks" | "notes" | "patched";
type BrowseDeckKey = "wrong" | "bookmarks" | "notes" | "patched";

type RunningSession = {
  session: QuizSession;
  index: number;
  selected: Set<number>;
  submitted: boolean;
  startedQuestionAt: number;
  answerMap: Record<string, { selected: string; isCorrect: boolean }>;
};

const LEGACY_MIGRATION_KEY = "se_next_app_migrated_v1";

function uid(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toMap<T extends { questionId: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.questionId, item])) as Record<string, T>;
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function shuffleIds(ids: string[]) {
  const copy = [...ids];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function isTrueFalseQuestion(question: EffectiveQuestion) {
  const options = question.options.map((option) => normalizeOption(option).trim().toLowerCase().replace(/[.。]+$/g, ""));
  return options.length === 2 && options.includes("true") && options.includes("false");
}

export function QuizWorkspace() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [patches, setPatches] = useState<Record<string, QuestionPatch>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [reviewStates, setReviewStates] = useState<Record<string, ReviewState>>({});
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sessions, setSessions] = useState<QuizSession[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [mode, setMode] = useState<QuizMode>("all");
  const [chapter, setChapter] = useState("1");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(8);
  const [shuffle, setShuffle] = useState(true);
  const [running, setRunning] = useState<RunningSession | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [libraryScope, setLibraryScope] = useState<LibraryScope>("all");
  const [query, setQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTopic, setEditTopic] = useState("");
  const [editOptions, setEditOptions] = useState("");
  const [editAnswer, setEditAnswer] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [status, setStatus] = useState("正在加载题库...");
  const importRef = useRef<HTMLInputElement>(null);

  const effectiveQuestions = useMemo(
    () => questions.map((question) => applyPatch(question, patches[question.id])),
    [patches, questions],
  );

  const questionById = useMemo(() => {
    return Object.fromEntries(effectiveQuestions.map((question) => [question.id, question])) as Record<string, EffectiveQuestion>;
  }, [effectiveQuestions]);

  const baseQuestionById = useMemo(() => {
    return Object.fromEntries(questions.map((question) => [question.id, question])) as Record<string, Question>;
  }, [questions]);

  const chapters = useMemo(
    () => [...new Set(questions.map((question) => question.chapter))].sort((a, b) => chapterSortValue(a) - chapterSortValue(b)),
    [questions],
  );

  const selectedQuestion = selectedQuestionId ? questionById[selectedQuestionId] : null;
  const selectedSession = selectedSessionId ? sessions.find((session) => session.id === selectedSessionId) || null : null;
  const currentQuestion = running ? questionById[running.session.questionIds[running.index]] : null;
  const currentAnswer = currentQuestion ? running?.answerMap[currentQuestion.id] : undefined;
  const detailQuestion = view === "quiz" && running?.submitted ? currentQuestion : selectedQuestion;

  const stats = useMemo(() => {
    const totalAttempts = attempts.length;
    const correctAttempts = attempts.filter((attempt) => attempt.isCorrect).length;
    const weak = Object.values(reviewStates).filter((state) => hasWrongHistory(state) && state.status === "weak").length;
    const mastered = Object.values(reviewStates).filter((state) => state.status === "mastered").length;
    return {
      totalAttempts,
      correctRate: totalAttempts ? Math.round((correctAttempts / totalAttempts) * 100) : 0,
      weak,
      mastered,
      bookmarks: Object.keys(bookmarks).length,
      notes: Object.keys(notes).length,
      patches: Object.keys(patches).length,
    };
  }, [attempts, bookmarks, notes, patches, reviewStates]);

  const browseDecks = useMemo(() => {
    const byPriority = (a: EffectiveQuestion, b: EffectiveQuestion) =>
      reviewPriority(reviewStates[b.id], Boolean(bookmarks[b.id]), Boolean(notes[b.id])) -
      reviewPriority(reviewStates[a.id], Boolean(bookmarks[a.id]), Boolean(notes[a.id]));

    return {
      wrong: effectiveQuestions
        .filter((question) => hasWrongHistory(reviewStates[question.id]))
        .sort(byPriority),
      bookmarks: effectiveQuestions.filter((question) => bookmarks[question.id]).sort(byPriority),
      notes: effectiveQuestions.filter((question) => notes[question.id]).sort(byPriority),
      patched: effectiveQuestions.filter((question) => patches[question.id]).sort(byPriority),
    } satisfies Record<BrowseDeckKey, EffectiveQuestion[]>;
  }, [bookmarks, effectiveQuestions, notes, patches, reviewStates]);

  const refreshLocalData = useCallback(async () => {
    const snapshot = await getSnapshot();
    const normalizedReviewStates = snapshot.reviewStates.map(normalizeReviewState);
    const needsReviewStateCleanup = normalizedReviewStates.some((state, index) => state.status !== snapshot.reviewStates[index]?.status);
    const normalizedSnapshot = { ...snapshot, reviewStates: normalizedReviewStates };
    if (needsReviewStateCleanup) {
      await getDb().reviewStates.bulkPut(normalizedReviewStates);
      await syncSnapshotToDisk(normalizedSnapshot);
    }
    setAttempts(normalizedSnapshot.attempts);
    setBookmarks(toMap(normalizedSnapshot.bookmarks));
    setNotes(toMap(normalizedSnapshot.notes));
    setPatches(toMap(normalizedSnapshot.patches));
    setReviewStates(toMap(normalizedReviewStates));
    setSessions(normalizedSnapshot.sessions.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()));
    return normalizedSnapshot;
  }, []);

  const importLegacyItems = useCallback(async (items: ImportedLegacyItem[], source: "wrong" | "bookmark", sourceQuestions: Question[]) => {
    const db = getDb();
    const nextBookmarks: Bookmark[] = [];
    const nextReviewStates: ReviewState[] = [];
    const now = new Date().toISOString();

    items.forEach((item) => {
      const match = findQuestionByLegacyItem(sourceQuestions, item);
      if (!match) return;
      if (source === "bookmark") {
        nextBookmarks.push({ questionId: match.id, createdAt: now });
      } else {
        const wrongCount = Math.max(1, Number(item.wrongCount) || 1);
        nextReviewStates.push({
          questionId: match.id,
          attemptCount: wrongCount,
          wrongCount,
          correctStreak: 0,
          lastAnsweredAt: item.lastWrongAt || now,
          lastResult: false,
          status: "weak",
        });
      }
    });

    await db.transaction("rw", db.bookmarks, db.reviewStates, async () => {
      if (nextBookmarks.length) await db.bookmarks.bulkPut(nextBookmarks);
      if (nextReviewStates.length) await db.reviewStates.bulkPut(nextReviewStates);
    });
  }, []);

  const migrateLegacyStorage = useCallback(
    async (sourceQuestions: Question[]) => {
      if (typeof window === "undefined" || localStorage.getItem(LEGACY_MIGRATION_KEY)) return;
      const readLegacy = (key: string) => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "[]");
          return Array.isArray(parsed) ? (parsed as ImportedLegacyItem[]) : [];
        } catch {
          return [];
        }
      };
      await importLegacyItems(readLegacy("se_wrong_list"), "wrong", sourceQuestions);
      await importLegacyItems(readLegacy("se_bookmarks"), "bookmark", sourceQuestions);
      localStorage.setItem(LEGACY_MIGRATION_KEY, new Date().toISOString());
    },
    [importLegacyItems],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/tiku.json", { cache: "no-store" });
        if (!response.ok) throw new Error("题库加载失败");
        const bank = (await response.json()) as QuestionBank;
        const hydrated = hydrateQuestions(bank);
        if (cancelled) return;
        setQuestions(hydrated);
        if (hydrated[0]) {
          setChapter(hydrated[0].chapter);
          setRangeStart(chapterSortValue(hydrated[0].chapter));
          setRangeEnd(Math.min(8, chapterSortValue(hydrated[hydrated.length - 1].chapter)));
          setSelectedQuestionId(hydrated[0].id);
        }
        const diskSnapshot = await fetchDiskSnapshot();
        if (diskSnapshot && hasSnapshotContent(diskSnapshot)) {
          await replaceSnapshot(diskSnapshot);
        }
        await migrateLegacyStorage(hydrated);
        const snapshot = await refreshLocalData();
        const synced = await syncSnapshotToDisk(snapshot);
        const storeLabel = synced ? "本地数据库已连接" : "浏览器本地保存";
        setStatus(`题库已加载：${Object.keys(bank).length} 章 · ${hydrated.length} 题 · ${storeLabel}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "题库加载失败");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [migrateLegacyStorage, refreshLocalData]);

  useEffect(() => {
    if (!detailQuestion) return;
    const patch = patches[detailQuestion.id];
    setNoteDraft(notes[detailQuestion.id]?.content || "");
    setEditTopic(patch?.topic ?? detailQuestion.baseTopic);
    setEditOptions((patch?.options ?? detailQuestion.baseOptions).join("\n"));
    setEditAnswer(patch?.answer ?? detailQuestion.baseAnswer);
    setEditExplanation(patch?.explanation || "");
    setAiText("");
    setEditOpen(false);
  }, [detailQuestion, notes, patches]);

  function buildQueue(nextMode: QuizMode) {
    if (nextMode === "miniTest") {
      const choiceIds = shuffleIds(effectiveQuestions.filter((question) => !isTrueFalseQuestion(question)).map((question) => question.id)).slice(0, 10);
      const trueFalseIds = shuffleIds(effectiveQuestions.filter(isTrueFalseQuestion).map((question) => question.id)).slice(0, 10);
      return shuffleIds([...choiceIds, ...trueFalseIds]);
    }

    let source = effectiveQuestions;
    if (nextMode === "single") source = source.filter((question) => question.chapter === chapter);
    if (nextMode === "range") {
      const start = Math.min(rangeStart, rangeEnd);
      const end = Math.max(rangeStart, rangeEnd);
      source = source.filter((question) => {
        const chapterValue = chapterSortValue(question.chapter);
        return chapterValue >= start && chapterValue <= end;
      });
    }
    if (nextMode === "wrong") {
      source = source.filter((question) => hasWrongHistory(reviewStates[question.id]));
    }
    if (nextMode === "bookmarks") source = source.filter((question) => bookmarks[question.id]);
    if (nextMode === "review") {
      source = [...source]
        .filter((question) => reviewPriority(reviewStates[question.id], Boolean(bookmarks[question.id]), Boolean(notes[question.id])) > 0)
        .sort(
          (a, b) =>
            reviewPriority(reviewStates[b.id], Boolean(bookmarks[b.id]), Boolean(notes[b.id])) -
            reviewPriority(reviewStates[a.id], Boolean(bookmarks[a.id]), Boolean(notes[a.id])),
        )
        .slice(0, 20);
    }
    const ids = source.map((question) => question.id);
    return shuffle && nextMode !== "review" ? shuffleIds(ids) : ids;
  }

  async function startQuizWithIds(nextMode: QuizMode, ids: string[], filters: QuizSession["filters"], emptyMessage: string) {
    if (!ids.length) {
      setStatus(emptyMessage);
      return;
    }
    const now = new Date().toISOString();
    const session: QuizSession = {
      id: uid("session"),
      mode: nextMode,
      filters,
      questionIds: ids,
      startedAt: now,
      total: ids.length,
      answered: 0,
      correct: 0,
    };
    await getDb().sessions.put(session);
    const diskSynced = await syncSnapshotToDisk();
    setSessions((current) => [session, ...current]);
    setRunning({
      session,
      index: 0,
      selected: new Set(),
      submitted: false,
      startedQuestionAt: Date.now(),
      answerMap: {},
    });
    setSelectedQuestionId(ids[0]);
    setView("quiz");
    setStatus(`已开始：${modeLabel(nextMode)} · ${ids.length} 题${diskSynced ? "" : " · 本地文件同步失败"}`);
  }

  async function startQuiz(nextMode: QuizMode = mode) {
    const ids = buildQueue(nextMode);
    await startQuizWithIds(
      nextMode,
      ids,
      { chapter, rangeStart: Math.min(rangeStart, rangeEnd), rangeEnd: Math.max(rangeStart, rangeEnd) },
      "当前模式下没有可刷题目",
    );
  }

  async function startSessionWrongQuiz(session: QuizSession, wrongQuestionIds: string[]) {
    await startQuizWithIds(
      "sessionWrong",
      wrongQuestionIds,
      { sourceSessionId: session.id },
      "这轮记录没有错题可重做",
    );
  }

  async function startSessionBookmarkQuiz(session: QuizSession, bookmarkedQuestionIds: string[]) {
    await startQuizWithIds(
      "sessionBookmarks",
      bookmarkedQuestionIds,
      { sourceSessionId: session.id },
      "这轮记录没有收藏题可重做",
    );
  }

  async function submitAnswer() {
    if (!running || !currentQuestion || running.selected.size === 0 || running.submitted) return;
    const selected = selectedAnswerString(running.selected);
    const isCorrect = isAnswerCorrect(selected, currentQuestion.answer);
    const now = new Date().toISOString();
    const attempt: Attempt = {
      id: uid("attempt"),
      sessionId: running.session.id,
      questionId: currentQuestion.id,
      chapter: currentQuestion.chapter,
      selectedAnswer: selected,
      correctAnswerSnapshot: currentQuestion.answer,
      isCorrect,
      answeredAt: now,
      durationMs: Date.now() - running.startedQuestionAt,
      mode: running.session.mode,
    };
    const oldState = reviewStates[currentQuestion.id];
    const nextState: ReviewState = {
      questionId: currentQuestion.id,
      attemptCount: (oldState?.attemptCount || 0) + 1,
      wrongCount: (oldState?.wrongCount || 0) + (isCorrect ? 0 : 1),
      correctStreak: isCorrect ? (oldState?.correctStreak || 0) + 1 : 0,
      lastAnsweredAt: now,
      lastResult: isCorrect,
      status: deriveReviewStatus((oldState?.wrongCount || 0) + (isCorrect ? 0 : 1), isCorrect ? (oldState?.correctStreak || 0) + 1 : 0),
    };
    const nextSession = {
      ...running.session,
      answered: running.session.answered + 1,
      correct: running.session.correct + (isCorrect ? 1 : 0),
    };

    const db = getDb();
    await db.transaction("rw", db.attempts, db.reviewStates, db.sessions, async () => {
      await db.attempts.put(attempt);
      await db.reviewStates.put(nextState);
      await db.sessions.put(nextSession);
    });
    await syncSnapshotToDisk();

    setAttempts((current) => [attempt, ...current]);
    setReviewStates((current) => ({ ...current, [currentQuestion.id]: nextState }));
    setSessions((current) => current.map((session) => (session.id === nextSession.id ? nextSession : session)));
    setRunning({
      ...running,
      session: nextSession,
      submitted: true,
      answerMap: {
        ...running.answerMap,
        [currentQuestion.id]: { selected, isCorrect },
      },
    });
    setSelectedQuestionId(currentQuestion.id);
  }

  async function nextQuestion() {
    if (!running) return;
    if (running.index >= running.session.questionIds.length - 1) {
      const finished = { ...running.session, finishedAt: new Date().toISOString() };
      await getDb().sessions.put(finished);
      const diskSynced = await syncSnapshotToDisk();
      setSessions((current) => current.map((session) => (session.id === finished.id ? finished : session)));
      setRunning(null);
      setView("history");
      setSelectedSessionId(finished.id);
      setStatus(`本轮完成：${finished.correct}/${finished.answered}${diskSynced ? "" : " · 本地文件同步失败"}`);
      return;
    }
    const nextIndex = running.index + 1;
    const nextId = running.session.questionIds[nextIndex];
    setRunning({
      ...running,
      index: nextIndex,
      selected: new Set(),
      submitted: false,
      startedQuestionAt: Date.now(),
    });
    setSelectedQuestionId(nextId);
  }

  function toggleSelected(index: number) {
    if (!running || running.submitted) return;
    const next = new Set(running.selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setRunning({ ...running, selected: next });
  }

  async function toggleBookmark(questionId: string) {
    const db = getDb();
    if (bookmarks[questionId]) {
      await db.bookmarks.delete(questionId);
      const diskSynced = await syncSnapshotToDisk();
      setBookmarks((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      if (!diskSynced) setStatus("收藏已更新，但本地文件数据库同步失败");
      return;
    }
    const bookmark = { questionId, createdAt: new Date().toISOString() };
    await db.bookmarks.put(bookmark);
    const diskSynced = await syncSnapshotToDisk();
    setBookmarks((current) => ({ ...current, [questionId]: bookmark }));
    if (!diskSynced) setStatus("收藏已更新，但本地文件数据库同步失败");
  }

  async function saveNote() {
    if (!detailQuestion) return;
    await saveQuestionNote(detailQuestion.id, noteDraft);
  }

  async function saveQuestionNote(questionId: string, content: string) {
    const note: Note = {
      questionId,
      content,
      updatedAt: new Date().toISOString(),
    };
    if (content.trim()) {
      await getDb().notes.put(note);
      const diskSynced = await syncSnapshotToDisk();
      setNotes((current) => ({ ...current, [questionId]: note }));
      setStatus(diskSynced ? "笔记已保存" : "笔记已保存，但本地文件数据库同步失败");
    } else {
      await getDb().notes.delete(questionId);
      const diskSynced = await syncSnapshotToDisk();
      setNotes((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      setStatus(diskSynced ? "空笔记已移除" : "空笔记已移除，但本地文件数据库同步失败");
    }
    if (detailQuestion?.id === questionId) setNoteDraft(content);
  }

  async function savePatch() {
    if (!detailQuestion) return;
    const options = editOptions
      .split("\n")
      .map((option) => option.trim())
      .filter(Boolean);
    const patch: QuestionPatch = {
      questionId: detailQuestion.id,
      topic: editTopic.trim(),
      options,
      answer: normalizeAnswer(editAnswer),
      explanation: editExplanation.trim(),
      updatedAt: new Date().toISOString(),
    };
    await getDb().patches.put(patch);
    const diskSynced = await syncSnapshotToDisk();
    setPatches((current) => ({ ...current, [detailQuestion.id]: patch }));
    setEditOpen(false);
    setStatus(diskSynced ? "本地修订已保存" : "本地修订已保存，但本地文件数据库同步失败");
  }

  async function resetPatch() {
    if (!detailQuestion) return;
    await getDb().patches.delete(detailQuestion.id);
    const diskSynced = await syncSnapshotToDisk();
    setPatches((current) => {
      const next = { ...current };
      delete next[detailQuestion.id];
      return next;
    });
    const base = baseQuestionById[detailQuestion.id];
    if (base) {
      setEditTopic(base.topic);
      setEditOptions(base.options.join("\n"));
      setEditAnswer(base.answer);
      setEditExplanation("");
    }
    setStatus(diskSynced ? "已恢复原题" : "已恢复原题，但本地文件数据库同步失败");
  }

  async function requestAI(question: EffectiveQuestion) {
    setAiLoading(true);
    setAiText("正在分析...");
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, topic: question.topic, options: question.options, answer: question.answer }),
      });
      const data = (await response.json()) as { analysis?: string; error?: string };
      setAiText(data.error ? `无法分析：${data.error}` : data.analysis || "AI 未返回内容");
    } catch (error) {
      setAiText(`无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAiLoading(false);
    }
  }

  async function exportData() {
    const snapshot = await getSnapshot();
    await syncSnapshotToDisk(snapshot);
    downloadJson({ schemaVersion: 1, exportedAt: new Date().toISOString(), data: snapshot }, "ZJU-SE-quiz-data");
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { data?: Partial<StoredSnapshot> } | ImportedLegacyItem[];
      const db = getDb();
      if (Array.isArray(parsed)) {
        const source = parsed.some((item) => item.userAnswer || item.wrongCount) ? "wrong" : "bookmark";
        await importLegacyItems(parsed, source, questions);
      } else if (parsed.data) {
        const data = { ...EMPTY_SNAPSHOT, ...parsed.data };
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
          await db.attempts.bulkPut(data.attempts || []);
          await db.bookmarks.bulkPut(data.bookmarks || []);
          await db.notes.bulkPut(data.notes || []);
          await db.patches.bulkPut(data.patches || []);
          await db.reviewStates.bulkPut(data.reviewStates || []);
          await db.sessions.bulkPut(data.sessions || []);
          await db.shortAnswerAttempts.bulkPut(data.shortAnswerAttempts || []);
          await db.shortAnswerBookmarks.bulkPut(data.shortAnswerBookmarks || []);
          await db.shortAnswerNotes.bulkPut(data.shortAnswerNotes || []);
          await db.shortAnswerStates.bulkPut(data.shortAnswerStates || []);
          },
        );
      }
      const snapshot = await refreshLocalData();
      const diskSynced = await syncSnapshotToDisk(snapshot);
      setStatus(diskSynced ? "导入完成，本地数据库已同步" : "导入完成，但本地文件数据库同步失败");
    } catch (error) {
      setStatus(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      event.target.value = "";
    }
  }

  const libraryQuestions = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return effectiveQuestions.filter((question) => {
      if (libraryScope === "wrong" && !hasWrongHistory(reviewStates[question.id])) return false;
      if (libraryScope === "bookmarks" && !bookmarks[question.id]) return false;
      if (libraryScope === "notes" && !notes[question.id]) return false;
      if (libraryScope === "patched" && !patches[question.id]) return false;
      if (!lower) return true;
      return `${question.topic} ${question.options.join(" ")}`.toLowerCase().includes(lower);
    });
  }, [bookmarks, effectiveQuestions, libraryScope, notes, patches, query, reviewStates]);

  const hidePracticeDetail = view === "quiz" && Boolean(running && !running.submitted);
  const useFocusedShell = hidePracticeDetail || view === "short-answer";

  return (
    <main className="workspace">
      <header className="topbar">
        <div>
          <p className="eyebrow">ZJU Software Engineering</p>
          <h1>刷题工作台</h1>
        </div>
        <div className="status-pill">{status}</div>
      </header>

      <div className={useFocusedShell ? "app-shell practice-focus" : "app-shell"}>
        <aside className="rail" aria-label="主导航">
          <button className={view === "dashboard" ? "rail-item active" : "rail-item"} onClick={() => setView("dashboard")}>
            <Target size={18} /> 工作台
          </button>
          <button className={view === "quiz" ? "rail-item active" : "rail-item"} onClick={() => setView("quiz")}>
            <BookOpen size={18} /> 刷题
          </button>
          <button className={view === "library" ? "rail-item active" : "rail-item"} onClick={() => setView("library")}>
            <Library size={18} /> 题库
          </button>
          <button className={view === "history" ? "rail-item active" : "rail-item"} onClick={() => setView("history")}>
            <History size={18} /> 记录
          </button>
          <button className={view === "short-answer" ? "rail-item active" : "rail-item"} onClick={() => setView("short-answer")}>
            <NotebookPen size={18} /> 简答
          </button>
          <a className="rail-item muted" href="/legacy.html">
            <Archive size={18} /> 旧版
          </a>
        </aside>

        <section className="main-panel">
          {view === "dashboard" && (
            <Dashboard
              stats={stats}
              mode={mode}
              setMode={setMode}
              chapter={chapter}
              setChapter={setChapter}
              rangeStart={rangeStart}
              setRangeStart={setRangeStart}
              rangeEnd={rangeEnd}
              setRangeEnd={setRangeEnd}
              chapters={chapters}
              shuffle={shuffle}
              setShuffle={setShuffle}
              startQuiz={startQuiz}
              exportData={exportData}
              importRef={importRef}
              browseDecks={browseDecks}
              bookmarks={bookmarks}
              notes={notes}
              patches={patches}
              reviewStates={reviewStates}
              selectQuestion={(id) => {
                setSelectedQuestionId(id);
                setStatus("已打开题目详情，可直接浏览、做笔记或编辑答案");
              }}
              openLibrary={(scope) => {
                setLibraryScope(scope);
                setQuery("");
                setView("library");
              }}
            />
          )}
          {view === "quiz" && (
            <QuizPanel
              running={running}
              question={currentQuestion}
              currentAnswer={currentAnswer}
              toggleSelected={toggleSelected}
              submitAnswer={submitAnswer}
              nextQuestion={nextQuestion}
              toggleBookmark={toggleBookmark}
              isBookmarked={currentQuestion ? Boolean(bookmarks[currentQuestion.id]) : false}
            />
          )}
          {view === "library" && (
            <LibraryPanel
              questions={libraryQuestions}
              scope={libraryScope}
              setScope={setLibraryScope}
              query={query}
              setQuery={setQuery}
              bookmarks={bookmarks}
              notes={notes}
              patches={patches}
              reviewStates={reviewStates}
              selectedQuestionId={selectedQuestionId}
              selectQuestion={(id) => setSelectedQuestionId(id)}
              saveQuestionNote={saveQuestionNote}
            />
          )}
          {view === "history" && (
            <HistoryPanel
              sessions={sessions}
              attempts={attempts}
              questionById={questionById}
              bookmarks={bookmarks}
              selectedSession={selectedSession}
              setSelectedSessionId={setSelectedSessionId}
              selectedQuestionId={selectedQuestionId}
              startSessionWrongQuiz={startSessionWrongQuiz}
              startSessionBookmarkQuiz={startSessionBookmarkQuiz}
              selectQuestion={(id) => {
                setSelectedQuestionId(id);
                setStatus("已打开复盘题目详情");
              }}
            />
          )}
          {view === "short-answer" && <ShortAnswerWorkspace setStatus={setStatus} />}
        </section>

        {!hidePracticeDetail && view !== "short-answer" && (
          <QuestionDetail
            question={detailQuestion}
            bookmarks={bookmarks}
            notes={notes}
            reviewState={detailQuestion ? reviewStates[detailQuestion.id] : undefined}
            attempts={detailQuestion ? attempts.filter((attempt) => attempt.questionId === detailQuestion.id) : []}
            noteDraft={noteDraft}
            setNoteDraft={setNoteDraft}
            saveNote={saveNote}
            toggleBookmark={toggleBookmark}
            editOpen={editOpen}
            setEditOpen={setEditOpen}
            editTopic={editTopic}
            setEditTopic={setEditTopic}
            editOptions={editOptions}
            setEditOptions={setEditOptions}
            editAnswer={editAnswer}
            setEditAnswer={setEditAnswer}
            editExplanation={editExplanation}
            setEditExplanation={setEditExplanation}
            savePatch={savePatch}
            resetPatch={resetPatch}
            requestAI={requestAI}
            aiText={aiText}
            aiLoading={aiLoading}
          />
        )}
      </div>

      <input ref={importRef} className="hidden-input" type="file" accept="application/json,.json" onChange={handleImport} />
    </main>
  );
}

function Dashboard({
  stats,
  mode,
  setMode,
  chapter,
  setChapter,
  rangeStart,
  setRangeStart,
  rangeEnd,
  setRangeEnd,
  chapters,
  shuffle,
  setShuffle,
  startQuiz,
  exportData,
  importRef,
  browseDecks,
  bookmarks,
  notes,
  patches,
  reviewStates,
  selectQuestion,
  openLibrary,
}: {
  stats: { totalAttempts: number; correctRate: number; weak: number; mastered: number; bookmarks: number; notes: number; patches: number };
  mode: QuizMode;
  setMode: (mode: QuizMode) => void;
  chapter: string;
  setChapter: (chapter: string) => void;
  rangeStart: number;
  setRangeStart: (value: number) => void;
  rangeEnd: number;
  setRangeEnd: (value: number) => void;
  chapters: string[];
  shuffle: boolean;
  setShuffle: (value: boolean) => void;
  startQuiz: (mode?: QuizMode) => void;
  exportData: () => void;
  importRef: React.RefObject<HTMLInputElement | null>;
  browseDecks: Record<BrowseDeckKey, EffectiveQuestion[]>;
  bookmarks: Record<string, Bookmark>;
  notes: Record<string, Note>;
  patches: Record<string, QuestionPatch>;
  reviewStates: Record<string, ReviewState>;
  selectQuestion: (id: string) => void;
  openLibrary: (scope: LibraryScope) => void;
}) {
  return (
    <div className="dashboard">
      <section className="study-strip">
        <div>
          <p className="eyebrow">Review loop</p>
          <h2>先刷题，再复盘，再复刷</h2>
        </div>
        <button className="primary-action" onClick={() => startQuiz(mode)}>
          <Play size={18} /> 开始
        </button>
      </section>

      <div className="metric-grid">
        <Metric label="答题次数" value={stats.totalAttempts} />
        <Metric label="正确率" value={`${stats.correctRate}%`} />
        <Metric label="待强化" value={stats.weak} tone="danger" />
        <Metric label="已掌握" value={stats.mastered} tone="success" />
        <Metric label="收藏" value={stats.bookmarks} />
        <Metric label="笔记" value={stats.notes} />
      </div>

      <section className="control-surface">
        <div className="mode-grid">
          {(["all", "single", "range", "wrong", "bookmarks", "review", "miniTest"] as QuizMode[]).map((item) => (
            <button key={item} className={mode === item ? "mode-card active" : "mode-card"} onClick={() => setMode(item)}>
              <span>{modeLabel(item)}</span>
              <small>{modeHint(item)}</small>
            </button>
          ))}
        </div>
        <div className="form-row">
          <label>
            章节
            <select value={chapter} onChange={(event) => setChapter(event.target.value)}>
              {chapters.map((item) => (
                <option key={item} value={item}>
                  第 {item} 章
                </option>
              ))}
            </select>
          </label>
          <label>
            起始章节
            <select
              value={rangeStart}
              onChange={(event) => {
                const nextStart = Number(event.target.value);
                setRangeStart(nextStart);
                if (nextStart > rangeEnd) setRangeEnd(nextStart);
              }}
            >
              {chapters.map((item) => {
                const value = chapterSortValue(item);
                return (
                  <option key={`range-start-${item}`} value={value}>
                    第 {item} 章
                  </option>
                );
              })}
            </select>
          </label>
          <label>
            结束章节
            <select
              value={rangeEnd}
              onChange={(event) => {
                const nextEnd = Number(event.target.value);
                setRangeEnd(nextEnd);
                if (nextEnd < rangeStart) setRangeStart(nextEnd);
              }}
            >
              {chapters.map((item) => {
                const value = chapterSortValue(item);
                return (
                  <option key={`range-end-${item}`} value={value}>
                    第 {item} 章
                  </option>
                );
              })}
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />
            随机顺序
          </label>
        </div>
        <div className="quick-row">
          <button onClick={() => startQuiz("wrong")}>
            <RefreshCcw size={16} /> 只刷错题
          </button>
          <button onClick={() => startQuiz("bookmarks")}>
            <Star size={16} /> 只刷收藏
          </button>
          <button onClick={() => startQuiz("review")}>
            <Brain size={16} /> 今日复习
          </button>
          <button onClick={() => startQuiz("miniTest")}>
            <ListFilter size={16} /> 开始小测
          </button>
          <button onClick={exportData}>
            <Download size={16} /> 导出数据
          </button>
          <button onClick={() => importRef.current?.click()}>
            <Upload size={16} /> 导入数据
          </button>
        </div>
      </section>

      <BrowseDecks
        decks={browseDecks}
        bookmarks={bookmarks}
        notes={notes}
        patches={patches}
        reviewStates={reviewStates}
        selectQuestion={selectQuestion}
        openLibrary={openLibrary}
        startQuiz={startQuiz}
      />
    </div>
  );
}

function BrowseDecks({
  decks,
  bookmarks,
  notes,
  patches,
  reviewStates,
  selectQuestion,
  openLibrary,
  startQuiz,
}: {
  decks: Record<BrowseDeckKey, EffectiveQuestion[]>;
  bookmarks: Record<string, Bookmark>;
  notes: Record<string, Note>;
  patches: Record<string, QuestionPatch>;
  reviewStates: Record<string, ReviewState>;
  selectQuestion: (id: string) => void;
  openLibrary: (scope: LibraryScope) => void;
  startQuiz: (mode?: QuizMode) => void;
}) {
  const configs: Array<{
    key: BrowseDeckKey;
    title: string;
    hint: string;
    icon: React.ReactNode;
    scope: LibraryScope;
    mode?: QuizMode;
  }> = [
    { key: "wrong", title: "错题速览", hint: "先看薄弱点，不必马上重刷", icon: <RefreshCcw size={16} />, scope: "wrong", mode: "wrong" },
    { key: "bookmarks", title: "收藏速览", hint: "快速扫重点题", icon: <Star size={16} />, scope: "bookmarks", mode: "bookmarks" },
    { key: "notes", title: "笔记速览", hint: "按自己的记录复盘", icon: <NotebookPen size={16} />, scope: "notes" },
    { key: "patched", title: "修订速览", hint: "检查改过答案的题", icon: <FilePenLine size={16} />, scope: "patched" },
  ];

  return (
    <section className="browse-surface">
      <div className="browse-heading">
        <div>
          <p className="eyebrow">Browse boards</p>
          <h2>卡片速览</h2>
        </div>
        <p>这些卡片是查看入口，不会启动答题流程；需要练习时再点击“开始练习”。</p>
      </div>
      <div className="browse-grid">
        {configs.map((config) => {
          const items = decks[config.key];
          return (
            <article key={config.key} className="browse-lane">
              <header>
                <div>
                  <span className="lane-icon">{config.icon}</span>
                  <strong>{config.title}</strong>
                  <small>{items.length} 题</small>
                </div>
                <button className="text-action" onClick={() => openLibrary(config.scope)}>
                  全部
                </button>
              </header>
              <p>{config.hint}</p>
              <div className="review-card-list">
                {items.length === 0 ? (
                  <div className="empty-card">暂无内容</div>
                ) : (
                  items.slice(0, 4).map((question) => (
                    <ReviewCard
                      key={`${config.key}-${question.id}`}
                      question={question}
                      bookmarked={Boolean(bookmarks[question.id])}
                      hasNote={Boolean(notes[question.id])}
                      patched={Boolean(patches[question.id])}
                      reviewState={reviewStates[question.id]}
                      selectQuestion={selectQuestion}
                    />
                  ))
                )}
              </div>
              {config.mode && items.length > 0 && (
                <button className="secondary-action wide" onClick={() => startQuiz(config.mode)}>
                  <Play size={15} /> 开始练习
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReviewCard({
  question,
  bookmarked,
  hasNote,
  patched,
  reviewState,
  selectQuestion,
}: {
  question: EffectiveQuestion;
  bookmarked: boolean;
  hasNote: boolean;
  patched: boolean;
  reviewState?: ReviewState;
  selectQuestion: (id: string) => void;
}) {
  return (
    <button className="review-card" onClick={() => selectQuestion(question.id)}>
      <span className="chapter-chip">Ch {question.chapter}</span>
      <strong>{question.topic.replace(/^\d+\.\s*/, "")}</strong>
      <span className="review-card-meta">
        <span>答案 {question.answer}</span>
        {reviewState && <span>{statusLabel(reviewState.status)}</span>}
        {bookmarked && <Star size={13} />}
        {hasNote && <NotebookPen size={13} />}
        {patched && <FilePenLine size={13} />}
      </span>
    </button>
  );
}

function QuizPanel({
  running,
  question,
  currentAnswer,
  toggleSelected,
  submitAnswer,
  nextQuestion,
  toggleBookmark,
  isBookmarked,
}: {
  running: RunningSession | null;
  question: EffectiveQuestion | null;
  currentAnswer?: { selected: string; isCorrect: boolean };
  toggleSelected: (index: number) => void;
  submitAnswer: () => void;
  nextQuestion: () => void;
  toggleBookmark: (questionId: string) => void;
  isBookmarked: boolean;
}) {
  if (!running || !question) {
    return (
      <section className="empty-panel">
        <BookOpen size={36} />
        <h2>还没有开始刷题</h2>
        <p>回到工作台选择模式，或从题库里打开一道题复习。</p>
      </section>
    );
  }
  const progress = Math.round(((running.index + (running.submitted ? 1 : 0)) / running.session.total) * 100);
  return (
    <section className="quiz-surface">
      <div className="quiz-meta">
        <span>Ch {question.chapter}</span>
        <span>
          {running.index + 1} / {running.session.total}
        </span>
        <span>{modeLabel(running.session.mode)}</span>
        <button className={isBookmarked ? "icon-button active" : "icon-button"} onClick={() => toggleBookmark(question.id)}>
          <Star size={17} /> 收藏
        </button>
      </div>
      <div className="progress-track">
        <div style={{ width: `${progress}%` }} />
      </div>
      <h2 className="question-title">{question.topic.replace(/^\d+\.\s*/, "")}</h2>
      <div className="option-stack">
        {question.options.map((option, index) => {
          const letter = String.fromCharCode(65 + index);
          const correct = normalizeAnswer(question.answer).includes(letter);
          const picked = running.selected.has(index);
          const submitted = running.submitted;
          const className = [
            "answer-option",
            picked ? "selected" : "",
            submitted && correct ? "correct" : "",
            submitted && picked && !correct ? "wrong" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={`${question.id}-${letter}`} className={className} onClick={() => toggleSelected(index)}>
              <span>{letter}</span>
              <strong>{normalizeOption(option)}</strong>
            </button>
          );
        })}
      </div>
      {running.submitted && currentAnswer && (
        <div className={currentAnswer.isCorrect ? "feedback success" : "feedback danger"}>
          {currentAnswer.isCorrect ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          你的答案 {currentAnswer.selected || "-"}，正确答案 {question.answer}
        </div>
      )}
      <div className="action-row">
        {!running.submitted ? (
          <button className="primary-action" disabled={running.selected.size === 0} onClick={submitAnswer}>
            提交答案
          </button>
        ) : (
          <button className="primary-action" onClick={nextQuestion}>
            {running.index >= running.session.total - 1 ? "完成复盘" : "下一题"}
          </button>
        )}
      </div>
    </section>
  );
}

function LibraryPanel({
  questions,
  scope,
  setScope,
  query,
  setQuery,
  bookmarks,
  notes,
  patches,
  reviewStates,
  selectedQuestionId,
  selectQuestion,
  saveQuestionNote,
}: {
  questions: EffectiveQuestion[];
  scope: LibraryScope;
  setScope: (scope: LibraryScope) => void;
  query: string;
  setQuery: (query: string) => void;
  bookmarks: Record<string, Bookmark>;
  notes: Record<string, Note>;
  patches: Record<string, QuestionPatch>;
  reviewStates: Record<string, ReviewState>;
  selectedQuestionId: string | null;
  selectQuestion: (id: string) => void;
  saveQuestionNote: (questionId: string, content: string) => Promise<void>;
}) {
  const showStudyCards = scope === "notes";

  return (
    <section className="library-panel">
      <div className="filter-bar">
        <div className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干或选项" />
        </div>
        <select value={scope} onChange={(event) => setScope(event.target.value as LibraryScope)}>
          <option value="all">全部题目</option>
          <option value="wrong">待强化</option>
          <option value="bookmarks">收藏</option>
          <option value="notes">有笔记</option>
          <option value="patched">已修订</option>
        </select>
      </div>
      {showStudyCards ? (
        <div className="study-card-list">
          {questions.length === 0 && <div className="empty-card">还没有带笔记的题目。</div>}
          {questions.map((question) => (
            <NoteStudyCard
              key={question.id}
              question={question}
              note={notes[question.id]}
              bookmarked={Boolean(bookmarks[question.id])}
              patched={Boolean(patches[question.id])}
              reviewState={reviewStates[question.id]}
              selected={selectedQuestionId === question.id}
              selectQuestion={selectQuestion}
              saveQuestionNote={saveQuestionNote}
            />
          ))}
        </div>
      ) : (
        <div className="question-list">
          {questions.map((question) => (
            <button key={question.id} className={selectedQuestionId === question.id ? "question-row active" : "question-row"} onClick={() => selectQuestion(question.id)}>
              <span className="chapter-chip">Ch {question.chapter}</span>
              <span className="row-topic">{question.topic.replace(/^\d+\.\s*/, "")}</span>
              <span className="row-badges">
                {hasWrongHistory(reviewStates[question.id]) && <span className="mini danger">错题</span>}
                {bookmarks[question.id] && <Star size={14} />}
                {notes[question.id] && <NotebookPen size={14} />}
                {patches[question.id] && <FilePenLine size={14} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function NoteStudyCard({
  question,
  note,
  bookmarked,
  patched,
  reviewState,
  selected,
  selectQuestion,
  saveQuestionNote,
}: {
  question: EffectiveQuestion;
  note?: Note;
  bookmarked: boolean;
  patched: boolean;
  reviewState?: ReviewState;
  selected: boolean;
  selectQuestion: (id: string) => void;
  saveQuestionNote: (questionId: string, content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(note?.content || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(note?.content || "");
  }, [note?.content, question.id]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveQuestionNote(question.id, draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={selected ? "study-note-card active" : "study-note-card"}>
      <div className="study-note-main">
        <div className="study-note-head">
          <span className="chapter-chip">Ch {question.chapter}</span>
          <span className="study-note-badges">
            {hasWrongHistory(reviewState) && <span className="mini danger">错题</span>}
            {reviewState && <span className="mini">{statusLabel(reviewState.status)}</span>}
            {bookmarked && <Star size={14} />}
            {patched && <FilePenLine size={14} />}
          </span>
        </div>
        <h3 className="study-note-title">{question.topic.replace(/^\d+\.\s*/, "")}</h3>
        <div className="study-note-options">
          {question.options.map((option, index) => (
            <div key={`${question.id}-study-${index}`}>
              <span>{String.fromCharCode(65 + index)}</span>
              <p>{normalizeOption(option)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="study-note-side">
        <section className="study-answer-block" aria-label="答案">
          <span>答案</span>
          <strong>{question.answer}</strong>
          {question.explanation && <p>{question.explanation}</p>}
        </section>
        <section className="study-note-block" aria-label="个人笔记">
          <span>
            <NotebookPen size={15} /> 个人笔记
          </span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void handleSave();
            }}
            placeholder="记录易错点、PPT 页码或自己的记忆方式"
          />
          <div className="study-note-actions">
            <small>{draft === (note?.content || "") ? "已同步" : "有未保存修改"}</small>
            <button className="study-save-button" disabled={saving || draft === (note?.content || "")} onClick={handleSave}>
              <Save size={14} /> {saving ? "保存中" : "保存笔记"}
            </button>
          </div>
        </section>
        <button className="study-open-button" onClick={() => selectQuestion(question.id)}>
          <FilePenLine size={15} /> 打开详情
        </button>
      </div>
    </article>
  );
}

function HistoryPanel({
  sessions,
  attempts,
  questionById,
  bookmarks,
  selectedSession,
  setSelectedSessionId,
  selectedQuestionId,
  startSessionWrongQuiz,
  startSessionBookmarkQuiz,
  selectQuestion,
}: {
  sessions: QuizSession[];
  attempts: Attempt[];
  questionById: Record<string, EffectiveQuestion>;
  bookmarks: Record<string, Bookmark>;
  selectedSession: QuizSession | null;
  setSelectedSessionId: (id: string) => void;
  selectedQuestionId: string | null;
  startSessionWrongQuiz: (session: QuizSession, wrongQuestionIds: string[]) => void;
  startSessionBookmarkQuiz: (session: QuizSession, bookmarkedQuestionIds: string[]) => void;
  selectQuestion: (id: string) => void;
}) {
  const sessionAttempts = useMemo(
    () => (selectedSession ? attempts.filter((attempt) => attempt.sessionId === selectedSession.id) : []),
    [attempts, selectedSession],
  );
  const wrongQuestionIds = useMemo(() => {
    if (!selectedSession) return [];
    const wrongSet = new Set(sessionAttempts.filter((attempt) => !attempt.isCorrect).map((attempt) => attempt.questionId));
    return selectedSession.questionIds.filter((questionId) => wrongSet.has(questionId));
  }, [selectedSession, sessionAttempts]);
  const bookmarkedQuestionIds = useMemo(
    () => (selectedSession ? selectedSession.questionIds.filter((questionId) => bookmarks[questionId]) : []),
    [bookmarks, selectedSession],
  );
  const lastKeyboardNavigationAt = useRef(0);

  useEffect(() => {
    if (!selectedSession || sessionAttempts.length === 0) return;

    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName.toLowerCase();
      return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
    }

    function selectByOffset(offset: number) {
      const currentIndex = sessionAttempts.findIndex((attempt) => attempt.questionId === selectedQuestionId);
      const fallbackIndex = offset > 0 ? 0 : sessionAttempts.length - 1;
      const nextIndex = currentIndex === -1 ? fallbackIndex : Math.min(sessionAttempts.length - 1, Math.max(0, currentIndex + offset));
      const nextAttempt = sessionAttempts[nextIndex];
      if (nextAttempt && nextAttempt.questionId !== selectedQuestionId) selectQuestion(nextAttempt.questionId);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const now = Date.now();
      if (now - lastKeyboardNavigationAt.current < 120) return;
      lastKeyboardNavigationAt.current = now;
      event.preventDefault();
      selectByOffset(event.key === "ArrowDown" ? 1 : -1);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedQuestionId, selectedSession, selectQuestion, sessionAttempts]);

  useEffect(() => {
    if (!selectedQuestionId) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(".attempt-row.active")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedQuestionId]);

  return (
    <section className="history-panel">
      <div className="session-list">
        {sessions.length === 0 && <p className="muted-copy">完成一轮刷题后，这里会出现历史记录。</p>}
        {sessions.map((session) => (
          <button key={session.id} className={selectedSession?.id === session.id ? "session-row active" : "session-row"} onClick={() => setSelectedSessionId(session.id)}>
            <span>{modeLabel(session.mode)}</span>
            <strong>
              {session.answered ? Math.round((session.correct / session.answered) * 100) : 0}% · {session.correct}/{session.answered}
            </strong>
            <small>{formatDate(session.finishedAt || session.startedAt)}</small>
          </button>
        ))}
      </div>
      <div className="session-detail">
        {!selectedSession ? (
          <div className="empty-panel compact">选择一轮记录查看错题和耗时。</div>
        ) : (
          <>
            <div className="detail-heading">
              <h2>{modeLabel(selectedSession.mode)}复盘</h2>
              <span>{selectedSession.total} 题</span>
            </div>
            <div className="history-actions">
              <button className="secondary-action" disabled={wrongQuestionIds.length === 0} onClick={() => startSessionWrongQuiz(selectedSession, wrongQuestionIds)}>
                <RefreshCcw size={16} /> 重做本轮错题 · {wrongQuestionIds.length}
              </button>
              <button className="secondary-action" disabled={bookmarkedQuestionIds.length === 0} onClick={() => startSessionBookmarkQuiz(selectedSession, bookmarkedQuestionIds)}>
                <Star size={16} /> 重做本轮收藏 · {bookmarkedQuestionIds.length}
              </button>
            </div>
            <div className="attempt-list">
              {sessionAttempts.map((attempt) => {
                const question = questionById[attempt.questionId];
                const active = selectedQuestionId === attempt.questionId;
                return (
                  <AttemptReviewCard
                    key={attempt.id}
                    attempt={attempt}
                    question={question}
                    active={active}
                    selectQuestion={selectQuestion}
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function AttemptReviewCard({
  attempt,
  question,
  active,
  selectQuestion,
}: {
  attempt: Attempt;
  question?: EffectiveQuestion;
  active: boolean;
  selectQuestion: (id: string) => void;
}) {
  const className = ["attempt-row", attempt.isCorrect ? "" : "wrong", active ? "active" : ""].filter(Boolean).join(" ");
  const selectedAnswer = normalizeAnswer(attempt.selectedAnswer);
  const correctAnswer = normalizeAnswer(attempt.correctAnswerSnapshot);

  return (
    <button className={className} onClick={() => selectQuestion(attempt.questionId)}>
      <div className="attempt-row-summary">
        <span className="attempt-status-icon">{attempt.isCorrect ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span>
        <strong>{question?.topic.replace(/^\d+\.\s*/, "") || attempt.questionId}</strong>
        <small>
          {attempt.selectedAnswer} / {attempt.correctAnswerSnapshot} · {formatDuration(attempt.durationMs)}
        </small>
      </div>

      {active && question && (
        <div className="attempt-expanded">
          <div className="attempt-answer-strip">
            <span className={attempt.isCorrect ? "mini success" : "mini danger"}>{attempt.isCorrect ? "正确" : "错误"}</span>
            <span>你的答案 {attempt.selectedAnswer || "-"}</span>
            <span>正确答案 {attempt.correctAnswerSnapshot}</span>
          </div>
          <div className="attempt-options">
            {question.options.map((option, index) => {
              const letter = String.fromCharCode(65 + index);
              const isCorrectOption = correctAnswer.includes(letter);
              const isPickedOption = selectedAnswer.includes(letter);
              const optionClassName = [
                "attempt-option",
                isCorrectOption ? "correct" : "",
                isPickedOption && !isCorrectOption ? "wrong" : "",
                isPickedOption ? "picked" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div key={`${attempt.id}-${letter}`} className={optionClassName}>
                  <span>{letter}</span>
                  <p>{normalizeOption(option)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </button>
  );
}

function QuestionDetail({
  question,
  bookmarks,
  notes,
  reviewState,
  attempts,
  noteDraft,
  setNoteDraft,
  saveNote,
  toggleBookmark,
  editOpen,
  setEditOpen,
  editTopic,
  setEditTopic,
  editOptions,
  setEditOptions,
  editAnswer,
  setEditAnswer,
  editExplanation,
  setEditExplanation,
  savePatch,
  resetPatch,
  requestAI,
  aiText,
  aiLoading,
}: {
  question: EffectiveQuestion | null;
  bookmarks: Record<string, Bookmark>;
  notes: Record<string, Note>;
  reviewState?: ReviewState;
  attempts: Attempt[];
  noteDraft: string;
  setNoteDraft: (value: string) => void;
  saveNote: () => void;
  toggleBookmark: (questionId: string) => void;
  editOpen: boolean;
  setEditOpen: (value: boolean) => void;
  editTopic: string;
  setEditTopic: (value: string) => void;
  editOptions: string;
  setEditOptions: (value: string) => void;
  editAnswer: string;
  setEditAnswer: (value: string) => void;
  editExplanation: string;
  setEditExplanation: (value: string) => void;
  savePatch: () => void;
  resetPatch: () => void;
  requestAI: (question: EffectiveQuestion) => void;
  aiText: string;
  aiLoading: boolean;
}) {
  if (!question) {
    return (
      <aside className="detail-panel">
        <div className="empty-panel compact">选择一道题查看详情、笔记和本地修订。</div>
      </aside>
    );
  }
  return (
    <aside className="detail-panel">
      <div className="detail-heading">
        <div>
          <span className="chapter-chip">Ch {question.chapter}</span>
          <h2>第 {question.number} 题</h2>
        </div>
        <button className={bookmarks[question.id] ? "icon-button active" : "icon-button"} onClick={() => toggleBookmark(question.id)}>
          <Star size={17} />
        </button>
      </div>
      <p className="detail-topic">{question.topic.replace(/^\d+\.\s*/, "")}</p>
      <div className="detail-meta">
        <span>答案 {question.answer}</span>
        <span>{reviewState ? statusLabel(reviewState.status) : "未作答"}</span>
        {question.patched && <span>已本地修订</span>}
      </div>
      <div className="mini-options">
        {question.options.map((option, index) => (
          <div key={`${question.id}-detail-${index}`}>
            <span>{String.fromCharCode(65 + index)}</span>
            {normalizeOption(option)}
          </div>
        ))}
      </div>
      {question.explanation && <p className="explanation">{question.explanation}</p>}

      <section className="detail-section">
        <div className="section-title">
          <NotebookPen size={16} /> 个人笔记
        </div>
        <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="写下易错点、PPT 页码或自己的记忆方式" />
        <button className="secondary-action" onClick={saveNote}>
          <Save size={16} /> 保存笔记
        </button>
      </section>

      <section className="detail-section">
        <button className="secondary-action wide" onClick={() => setEditOpen(!editOpen)}>
          <FilePenLine size={16} /> {editOpen ? "收起修订" : "编辑题目/答案"}
        </button>
        {editOpen && (
          <div className="edit-stack">
            <label>
              题干
              <textarea value={editTopic} onChange={(event) => setEditTopic(event.target.value)} />
            </label>
            <label>
              选项，每行一个
              <textarea value={editOptions} onChange={(event) => setEditOptions(event.target.value)} />
            </label>
            <label>
              正确答案
              <input value={editAnswer} onChange={(event) => setEditAnswer(event.target.value)} />
            </label>
            <label>
              解析/备注
              <textarea value={editExplanation} onChange={(event) => setEditExplanation(event.target.value)} />
            </label>
            <div className="action-row tight">
              <button className="primary-action" onClick={savePatch}>
                <Save size={16} /> 保存修订
              </button>
              <button className="secondary-action" onClick={resetPatch}>
                <RotateCcw size={16} /> 恢复原题
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="detail-section">
        <button className="secondary-action wide" disabled={aiLoading} onClick={() => requestAI(question)}>
          <Sparkles size={16} /> {aiLoading ? "分析中" : "AI 解析"}
        </button>
        {aiText && <p className="ai-box">{aiText}</p>}
      </section>

      <section className="detail-section">
        <div className="section-title">
          <ListFilter size={16} /> 答题历史
        </div>
        {attempts.length === 0 && <p className="muted-copy">这道题还没有作答记录。</p>}
        {attempts.slice(0, 5).map((attempt) => (
          <div key={attempt.id} className={attempt.isCorrect ? "mini-attempt" : "mini-attempt wrong"}>
            <span>{attempt.isCorrect ? "正确" : "错误"}</span>
            <strong>
              {attempt.selectedAnswer} / {attempt.correctAnswerSnapshot}
            </strong>
            <small>{formatDate(attempt.answeredAt)}</small>
          </div>
        ))}
      </section>
    </aside>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: "success" | "danger" }) {
  return (
    <div className={`metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function modeLabel(mode: QuizMode) {
  const labels: Record<QuizMode, string> = {
    all: "全部题",
    single: "单章",
    range: "章节范围",
    wrong: "错题",
    bookmarks: "收藏",
    review: "今日复习",
    miniTest: "小测",
    sessionWrong: "本轮错题",
    sessionBookmarks: "本轮收藏",
  };
  return labels[mode];
}

function modeHint(mode: QuizMode) {
  const hints: Record<QuizMode, string> = {
    all: "完整覆盖",
    single: "集中章节",
    range: "自选区间",
    wrong: "只刷薄弱项",
    bookmarks: "重点题组",
    review: "自动推荐 20 题",
    miniTest: "10 选择 + 10 判断",
    sessionWrong: "复盘错题",
    sessionBookmarks: "复盘收藏",
  };
  return hints[mode];
}

function statusLabel(status: ReviewState["status"]) {
  if (status === "mastered") return "已掌握";
  if (status === "weak") return "待强化";
  return "新题";
}

function downloadJson(data: unknown, prefix: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${prefix}_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
