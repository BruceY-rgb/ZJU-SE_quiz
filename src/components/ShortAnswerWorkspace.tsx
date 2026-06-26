"use client";

import { BookOpen, Brain, CheckCircle2, ListFilter, NotebookPen, Play, RefreshCcw, Save, Search, Star, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getDb, syncSnapshotToDisk } from "@/lib/db";
import {
  buildShortAnswerReviewDeck,
  deriveShortAnswerStatus,
  filterShortAnswerCards,
  shortAnswerRatingLabel,
  shortAnswerStatusLabel,
  type ShortAnswerMode,
} from "@/lib/shortAnswers";
import type { ShortAnswerAttempt, ShortAnswerBookmark, ShortAnswerCard, ShortAnswerNote, ShortAnswerRating, ShortAnswerState } from "@/types/quiz";

type RunningShortAnswer = {
  ids: string[];
  index: number;
  mode: ShortAnswerMode;
  group: string;
  response: string;
  answerVisible: boolean;
  startedAt: number;
  finished: number;
  known: number;
};

type ShortAnswerStats = {
  attempts: number;
  mastered: number;
  weak: number;
  bookmarks: number;
  notes: number;
};

function uid(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID()}`;
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toCardMap<T extends { cardId: string }>(items: T[]) {
  return Object.fromEntries(items.map((item) => [item.cardId, item])) as Record<string, T>;
}

function shuffleIds(ids: string[]) {
  const copy = [...ids];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
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

function modeLabel(mode: ShortAnswerMode) {
  const labels: Record<ShortAnswerMode, string> = {
    all: "全部简答",
    group: "专题",
    weak: "未掌握",
    bookmarks: "收藏",
    review: "今日复习",
  };
  return labels[mode];
}

function modeHint(mode: ShortAnswerMode) {
  const hints: Record<ShortAnswerMode, string> = {
    all: "完整背诵",
    group: "按专题过",
    weak: "只看薄弱",
    bookmarks: "重点卡片",
    review: "自动推荐",
  };
  return hints[mode];
}

export function ShortAnswerWorkspace({ setStatus }: { setStatus: (status: string) => void }) {
  const [cards, setCards] = useState<ShortAnswerCard[]>([]);
  const [attempts, setAttempts] = useState<ShortAnswerAttempt[]>([]);
  const [states, setStates] = useState<Record<string, ShortAnswerState>>({});
  const [bookmarks, setBookmarks] = useState<Record<string, ShortAnswerBookmark>>({});
  const [notes, setNotes] = useState<Record<string, ShortAnswerNote>>({});
  const [mode, setMode] = useState<ShortAnswerMode>("all");
  const [group, setGroup] = useState("");
  const [query, setQuery] = useState("");
  const [shuffle, setShuffle] = useState(true);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [running, setRunning] = useState<RunningShortAnswer | null>(null);
  const [practiceNoteDraft, setPracticeNoteDraft] = useState("");

  const refreshLocalData = useCallback(async () => {
    const db = getDb();
    const [nextAttempts, nextBookmarks, nextNotes, nextStates] = await Promise.all([
      db.shortAnswerAttempts.toArray(),
      db.shortAnswerBookmarks.toArray(),
      db.shortAnswerNotes.toArray(),
      db.shortAnswerStates.toArray(),
    ]);
    setAttempts(nextAttempts.sort((a, b) => new Date(b.answeredAt).getTime() - new Date(a.answeredAt).getTime()));
    setBookmarks(toCardMap(nextBookmarks));
    setNotes(toCardMap(nextNotes));
    setStates(toCardMap(nextStates));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/short-answer-cards.json", { cache: "no-store" });
        if (!response.ok) throw new Error("简答题加载失败");
        const loaded = (await response.json()) as ShortAnswerCard[];
        if (cancelled) return;
        const sorted = loaded.sort((a, b) => a.sourceOrder - b.sourceOrder);
        setCards(sorted);
        setSelectedCardId(sorted[0]?.id || null);
        setGroup(sorted[0]?.group || "");
        await refreshLocalData();
        setStatus(`简答题已加载：${sorted.length} 张卡 · 本地数据库已连接`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "简答题加载失败");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [refreshLocalData, setStatus]);

  const cardById = useMemo(() => Object.fromEntries(cards.map((card) => [card.id, card])) as Record<string, ShortAnswerCard>, [cards]);
  const groups = useMemo(() => [...new Set(cards.map((card) => card.group))], [cards]);
  const selectedCard = selectedCardId ? cardById[selectedCardId] : null;
  const currentCard = running ? cardById[running.ids[running.index]] : selectedCard;

  useEffect(() => {
    if (!currentCard) return;
    setPracticeNoteDraft(notes[currentCard.id]?.content || "");
  }, [currentCard, notes]);

  const stats = useMemo<ShortAnswerStats>(
    () => ({
      attempts: attempts.length,
      mastered: Object.values(states).filter((state) => state.status === "mastered").length,
      weak: Object.values(states).filter((state) => state.status === "weak").length,
      bookmarks: Object.keys(bookmarks).length,
      notes: Object.keys(notes).length,
    }),
    [attempts.length, bookmarks, notes, states],
  );

  function buildQueue(nextMode: ShortAnswerMode) {
    const source =
      nextMode === "review"
        ? buildShortAnswerReviewDeck(cards, states, bookmarks, notes)
        : filterShortAnswerCards(cards, nextMode, group, states, bookmarks);
    const ids = source.map((card) => card.id);
    return shuffle && nextMode !== "review" ? shuffleIds(ids) : ids;
  }

  function startPractice(nextMode: ShortAnswerMode = mode) {
    const ids = buildQueue(nextMode);
    if (!ids.length) {
      setStatus("当前简答题范围为空");
      return;
    }
    setMode(nextMode);
    setSelectedCardId(ids[0]);
    setRunning({
      ids,
      index: 0,
      mode: nextMode,
      group,
      response: "",
      answerVisible: false,
      startedAt: Date.now(),
      finished: 0,
      known: 0,
    });
    setStatus(`已开始：${modeLabel(nextMode)} · ${ids.length} 张卡`);
  }

  function revealAnswer() {
    if (!running) return;
    setRunning({ ...running, answerVisible: true });
  }

  async function toggleBookmark(cardId: string) {
    const db = getDb();
    if (bookmarks[cardId]) {
      await db.shortAnswerBookmarks.delete(cardId);
      const diskSynced = await syncSnapshotToDisk();
      setBookmarks((current) => {
        const next = { ...current };
        delete next[cardId];
        return next;
      });
      setStatus(diskSynced ? "简答收藏已移除" : "简答收藏已更新，但本地文件数据库同步失败");
      return;
    }
    const bookmark = { cardId, createdAt: new Date().toISOString() };
    await db.shortAnswerBookmarks.put(bookmark);
    const diskSynced = await syncSnapshotToDisk();
    setBookmarks((current) => ({ ...current, [cardId]: bookmark }));
    setStatus(diskSynced ? "简答卡已收藏" : "简答收藏已更新，但本地文件数据库同步失败");
  }

  async function saveNote(cardId: string, content: string) {
    const db = getDb();
    if (content.trim()) {
      const note = { cardId, content, updatedAt: new Date().toISOString() };
      await db.shortAnswerNotes.put(note);
      const diskSynced = await syncSnapshotToDisk();
      setNotes((current) => ({ ...current, [cardId]: note }));
      setStatus(diskSynced ? "简答笔记已保存" : "简答笔记已保存，但本地文件数据库同步失败");
      return;
    }
    await db.shortAnswerNotes.delete(cardId);
    const diskSynced = await syncSnapshotToDisk();
    setNotes((current) => {
      const next = { ...current };
      delete next[cardId];
      return next;
    });
    setStatus(diskSynced ? "空笔记已移除" : "空笔记已移除，但本地文件数据库同步失败");
  }

  async function rateCurrent(rating: ShortAnswerRating) {
    if (!running || !currentCard || !running.answerVisible) return;
    const now = new Date().toISOString();
    const oldState = states[currentCard.id];
    const knownStreak = rating === "known" ? (oldState?.knownStreak || 0) + 1 : 0;
    const nextState: ShortAnswerState = {
      cardId: currentCard.id,
      attemptCount: (oldState?.attemptCount || 0) + 1,
      knownStreak,
      lastRating: rating,
      status: deriveShortAnswerStatus(rating, knownStreak, oldState),
      lastAnsweredAt: now,
    };
    const attempt: ShortAnswerAttempt = {
      id: uid("sa_attempt"),
      cardId: currentCard.id,
      response: running.response,
      rating,
      answeredAt: now,
      durationMs: Date.now() - running.startedAt,
    };
    const db = getDb();
    await db.transaction("rw", db.shortAnswerAttempts, db.shortAnswerStates, async () => {
      await db.shortAnswerAttempts.put(attempt);
      await db.shortAnswerStates.put(nextState);
    });
    const diskSynced = await syncSnapshotToDisk();
    setAttempts((current) => [attempt, ...current]);
    setStates((current) => ({ ...current, [currentCard.id]: nextState }));

    if (running.index >= running.ids.length - 1) {
      const known = running.known + (rating === "known" ? 1 : 0);
      setRunning(null);
      setStatus(`简答练习完成：掌握 ${known}/${running.ids.length}${diskSynced ? "" : " · 本地文件同步失败"}`);
      return;
    }

    const nextIndex = running.index + 1;
    const nextId = running.ids[nextIndex];
    setSelectedCardId(nextId);
    setRunning({
      ...running,
      index: nextIndex,
      response: "",
      answerVisible: false,
      startedAt: Date.now(),
      finished: running.finished + 1,
      known: running.known + (rating === "known" ? 1 : 0),
    });
    setStatus(diskSynced ? `已记录：${shortAnswerRatingLabel(rating)}` : `已记录：${shortAnswerRatingLabel(rating)} · 本地文件同步失败`);
  }

  const visibleCards = useMemo(() => {
    const lower = query.trim().toLowerCase();
    const source =
      mode === "review"
        ? buildShortAnswerReviewDeck(cards, states, bookmarks, notes)
        : filterShortAnswerCards(cards, mode, group, states, bookmarks);
    if (!lower) return source;
    return source.filter((card) => `${card.title} ${card.prompt} ${card.group} ${card.points.join(" ")}`.toLowerCase().includes(lower));
  }, [bookmarks, cards, group, mode, notes, query, states]);

  return (
    <section className="short-answer-workspace">
      <ShortAnswerHeader stats={stats} cards={cards} startPractice={startPractice} />

      <section className="short-answer-control">
        <div className="mode-grid">
          {(["all", "group", "weak", "bookmarks", "review"] as ShortAnswerMode[]).map((item) => (
            <button key={item} className={mode === item ? "mode-card active" : "mode-card"} onClick={() => setMode(item)}>
              <span>{modeLabel(item)}</span>
              <small>{modeHint(item)}</small>
            </button>
          ))}
        </div>
        <div className="form-row">
          <label>
            专题
            <select value={group} onChange={(event) => setGroup(event.target.value)}>
              {groups.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />
            随机顺序
          </label>
        </div>
        <div className="quick-row">
          <button onClick={() => startPractice("weak")}>
            <RefreshCcw size={16} /> 练未掌握
          </button>
          <button onClick={() => startPractice("bookmarks")}>
            <Star size={16} /> 练收藏
          </button>
          <button onClick={() => startPractice("review")}>
            <Brain size={16} /> 今日复习
          </button>
        </div>
      </section>

      <ShortAnswerPracticePanel
        running={running}
        card={currentCard}
        bookmarked={currentCard ? Boolean(bookmarks[currentCard.id]) : false}
        noteDraft={practiceNoteDraft}
        setNoteDraft={setPracticeNoteDraft}
        revealAnswer={revealAnswer}
        setResponse={(response) => running && setRunning({ ...running, response })}
        toggleBookmark={toggleBookmark}
        saveNote={saveNote}
        rateCurrent={rateCurrent}
      />

      <section className="short-answer-browser">
        <div className="browse-heading">
          <div>
            <p className="eyebrow">Short answers</p>
            <h2>简答卡片</h2>
          </div>
          <div className="search-box">
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索简答题、要点或专题" />
          </div>
        </div>
        <div className="short-answer-card-grid">
          {visibleCards.length === 0 && <div className="empty-card">当前范围没有简答卡。</div>}
          {visibleCards.map((card) => (
            <ShortAnswerStudyCard
              key={card.id}
              card={card}
              selected={selectedCardId === card.id}
              locked={Boolean(running && !running.answerVisible)}
              state={states[card.id]}
              bookmarked={Boolean(bookmarks[card.id])}
              note={notes[card.id]}
              attempts={attempts.filter((attempt) => attempt.cardId === card.id)}
              selectCard={(id) => {
                setSelectedCardId(id);
                setRunning(null);
                setStatus("已打开简答卡片");
              }}
              toggleBookmark={toggleBookmark}
              saveNote={saveNote}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function ShortAnswerHeader({
  stats,
  cards,
  startPractice,
}: {
  stats: ShortAnswerStats;
  cards: ShortAnswerCard[];
  startPractice: () => void;
}) {
  return (
    <section className="short-answer-hero">
      <div>
        <p className="eyebrow">Recall lab</p>
        <h2>简答题自测</h2>
      </div>
      <button className="primary-action" onClick={startPractice}>
        <Play size={18} /> 开始自测
      </button>
      <div className="metric-grid short-answer-metrics">
        <Metric label="卡片" value={cards.length} />
        <Metric label="自测次数" value={stats.attempts} />
        <Metric label="待强化" value={stats.weak} tone="danger" />
        <Metric label="已掌握" value={stats.mastered} tone="success" />
        <Metric label="收藏" value={stats.bookmarks} />
        <Metric label="笔记" value={stats.notes} />
      </div>
    </section>
  );
}

function ShortAnswerPracticePanel({
  running,
  card,
  bookmarked,
  noteDraft,
  setNoteDraft,
  revealAnswer,
  setResponse,
  toggleBookmark,
  saveNote,
  rateCurrent,
}: {
  running: RunningShortAnswer | null;
  card: ShortAnswerCard | null;
  bookmarked: boolean;
  noteDraft: string;
  setNoteDraft: (value: string) => void;
  revealAnswer: () => void;
  setResponse: (response: string) => void;
  toggleBookmark: (cardId: string) => void;
  saveNote: (cardId: string, content: string) => Promise<void>;
  rateCurrent: (rating: ShortAnswerRating) => Promise<void>;
}) {
  if (!running || !card) {
    return (
      <section className="empty-panel short-answer-empty">
        <BookOpen size={34} />
        <h2>选择范围后开始自测</h2>
      </section>
    );
  }
  const progress = Math.round(((running.index + (running.answerVisible ? 1 : 0)) / running.ids.length) * 100);

  return (
    <section className="short-answer-practice">
      <div className="quiz-meta">
        <span>{card.group}</span>
        <span>
          {running.index + 1} / {running.ids.length}
        </span>
        <span>{modeLabel(running.mode)}</span>
        <button className={bookmarked ? "icon-button active" : "icon-button"} onClick={() => toggleBookmark(card.id)}>
          <Star size={17} /> 收藏
        </button>
      </div>
      <div className="progress-track">
        <div style={{ width: `${progress}%` }} />
      </div>
      <div className="short-answer-prompt">
        <span className="chapter-chip">{card.title}</span>
        <h3>{card.prompt}</h3>
      </div>
      <label className="short-answer-response">
        我的答案
        <textarea
          value={running.response}
          onChange={(event) => setResponse(event.target.value)}
          placeholder="先默写关键词、步骤或结构，再查看参考答案"
        />
      </label>

      {!running.answerVisible ? (
        <button className="primary-action" onClick={revealAnswer}>
          查看参考答案
        </button>
      ) : (
        <>
          <AnswerReference card={card} />
          <section className="short-answer-note-panel">
            <div className="section-title">
              <NotebookPen size={16} /> 个人笔记
            </div>
            <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} placeholder="记录易忘要点、口诀或 PPT 页码" />
            <button className="secondary-action" onClick={() => saveNote(card.id, noteDraft)}>
              <Save size={16} /> 保存笔记
            </button>
          </section>
          <div className="rating-row">
            <button className="rating-button known" onClick={() => rateCurrent("known")}>
              <CheckCircle2 size={17} /> 掌握
            </button>
            <button className="rating-button fuzzy" onClick={() => rateCurrent("fuzzy")}>
              <ListFilter size={17} /> 模糊
            </button>
            <button className="rating-button unknown" onClick={() => rateCurrent("unknown")}>
              <XCircle size={17} /> 不会
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ShortAnswerStudyCard({
  card,
  selected,
  locked,
  state,
  bookmarked,
  note,
  attempts,
  selectCard,
  toggleBookmark,
  saveNote,
}: {
  card: ShortAnswerCard;
  selected: boolean;
  locked: boolean;
  state?: ShortAnswerState;
  bookmarked: boolean;
  note?: ShortAnswerNote;
  attempts: ShortAnswerAttempt[];
  selectCard: (id: string) => void;
  toggleBookmark: (cardId: string) => void;
  saveNote: (cardId: string, content: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(note?.content || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(note?.content || "");
  }, [note?.content, card.id]);

  async function handleSave() {
    setSaving(true);
    try {
      await saveNote(card.id, draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={selected && !locked ? "short-answer-study-card active" : "short-answer-study-card"}>
      <button className="short-answer-study-main" onClick={() => selectCard(card.id)}>
        <span className="chapter-chip">{card.group}</span>
        <h3>{card.title}</h3>
        <p>{card.prompt}</p>
        <span className="review-card-meta">
          <span>{shortAnswerStatusLabel(state?.status)}</span>
          <span>{card.points.length} 要点</span>
          {card.images.length > 0 && <span>{card.images.length} 图</span>}
          {bookmarked && <Star size={13} />}
          {note && <NotebookPen size={13} />}
        </span>
      </button>

      {selected && !locked && (
        <div className="short-answer-study-detail">
          <div className="study-note-actions">
            <button className={bookmarked ? "icon-button active" : "icon-button"} onClick={() => toggleBookmark(card.id)}>
              <Star size={16} /> 收藏
            </button>
            <small>{attempts.length ? `${attempts.length} 次 · 最近 ${shortAnswerRatingLabel(attempts[0].rating)} · ${formatDuration(attempts[0].durationMs)}` : "未自测"}</small>
          </div>
          <AnswerReference card={card} />
          <section className="study-note-block">
            <span>
              <NotebookPen size={15} /> 个人笔记
            </span>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="记录这张卡的记忆方式" />
            <div className="study-note-actions">
              <small>{draft === (note?.content || "") ? "已同步" : "有未保存修改"}</small>
              <button className="study-save-button" disabled={saving || draft === (note?.content || "")} onClick={handleSave}>
                <Save size={14} /> {saving ? "保存中" : "保存笔记"}
              </button>
            </div>
          </section>
          {state?.lastAnsweredAt && <p className="muted-copy">上次自评：{shortAnswerRatingLabel(state.lastRating || "unknown")} · {formatDate(state.lastAnsweredAt)}</p>}
        </div>
      )}
    </article>
  );
}

function AnswerReference({ card }: { card: ShortAnswerCard }) {
  return (
    <section className="answer-reference">
      <div className="section-title">
        <CheckCircle2 size={16} /> 参考要点
      </div>
      {card.points.length > 0 && (
        <ol>
          {card.points.map((point, index) => (
            <li key={`${card.id}-point-${index}`}>{point}</li>
          ))}
        </ol>
      )}
      {card.images.length > 0 && (
        <div className="answer-image-grid">
          {card.images.map((image) => (
            <figure key={image.src}>
              <img src={image.src} alt={image.alt} />
              <figcaption>{image.alt}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
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
