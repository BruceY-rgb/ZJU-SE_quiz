import type { ShortAnswerBookmark, ShortAnswerCard, ShortAnswerNote, ShortAnswerRating, ShortAnswerState, ShortAnswerStatus } from "@/types/quiz";

export type ShortAnswerMode = "all" | "group" | "weak" | "bookmarks" | "review";

export function shortAnswerStatusLabel(status?: ShortAnswerStatus) {
  if (status === "mastered") return "已掌握";
  if (status === "weak") return "待强化";
  return "新题";
}

export function shortAnswerRatingLabel(rating: ShortAnswerRating) {
  if (rating === "known") return "掌握";
  if (rating === "fuzzy") return "模糊";
  return "不会";
}

export function deriveShortAnswerStatus(rating: ShortAnswerRating, knownStreak: number, previous?: ShortAnswerState): ShortAnswerStatus {
  if (knownStreak >= 2) return "mastered";
  if (rating === "known") return previous?.status === "weak" ? "weak" : "new";
  return "weak";
}

export function shortAnswerPriority(state?: ShortAnswerState, bookmarked = false, hasNote = false) {
  if (!state) return bookmarked || hasNote ? 18 : 6;
  const age = state.lastAnsweredAt
    ? Math.min(30, Math.floor((Date.now() - new Date(state.lastAnsweredAt).getTime()) / 86_400_000))
    : 30;
  const statusWeight = state.status === "weak" ? 90 : state.status === "new" ? 24 : 0;
  const ratingWeight = state.lastRating === "unknown" ? 30 : state.lastRating === "fuzzy" ? 18 : 0;
  return statusWeight + ratingWeight + age + (bookmarked ? 10 : 0) + (hasNote ? 4 : 0);
}

export function filterShortAnswerCards(
  cards: ShortAnswerCard[],
  mode: ShortAnswerMode,
  group: string,
  states: Record<string, ShortAnswerState>,
  bookmarks: Record<string, ShortAnswerBookmark>,
) {
  if (mode === "group") return cards.filter((card) => card.group === group);
  if (mode === "weak") return cards.filter((card) => states[card.id]?.status !== "mastered");
  if (mode === "bookmarks") return cards.filter((card) => bookmarks[card.id]);
  return cards;
}

export function buildShortAnswerReviewDeck(
  cards: ShortAnswerCard[],
  states: Record<string, ShortAnswerState>,
  bookmarks: Record<string, ShortAnswerBookmark>,
  notes: Record<string, ShortAnswerNote>,
) {
  const ranked = [...cards]
    .filter((card) => shortAnswerPriority(states[card.id], Boolean(bookmarks[card.id]), Boolean(notes[card.id])) > 0)
    .sort(
      (a, b) =>
        shortAnswerPriority(states[b.id], Boolean(bookmarks[b.id]), Boolean(notes[b.id])) -
        shortAnswerPriority(states[a.id], Boolean(bookmarks[a.id]), Boolean(notes[a.id])),
    );
  return (ranked.length ? ranked : cards).slice(0, 20);
}
