import type {
  EffectiveQuestion,
  ImportedLegacyItem,
  Question,
  QuestionPatch,
  ReviewState,
  RawQuestion,
} from "@/types/quiz";

export type QuestionBank = Record<string, RawQuestion[]>;

export function normalizeAnswer(answer: string | undefined | null) {
  return String(answer || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .split("")
    .sort()
    .join("");
}

export function normalizeOption(option: string) {
  return String(option).replace(/^[A-Z]\.\s*/, "");
}

export function hydrateQuestions(bank: QuestionBank): Question[] {
  return Object.entries(bank)
    .sort(([a], [b]) => Number(a) - Number(b))
    .flatMap(([chapter, items]) =>
      items.map((item, index) => {
        const normalized = normalizeMetaOptions(item.options || [], item.answer);
        return {
          id: `ch${chapter}-q${index + 1}`,
          chapter,
          number: index + 1,
          topic: item.topic,
          answer: normalized.answer,
          options: normalized.options,
        };
      }),
    );
}

type ParsedOption = {
  body: string;
  expansion: string[];
  index: number;
  kind: "ordinary" | "combo" | "all" | "none";
  oldLetter: string;
};

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function parseOption(option: string, index: number): ParsedOption {
  const fallbackLetter = optionLetter(index);
  const match = String(option).match(/^([A-E])\.\s*(.*)$/i);
  const oldLetter = (match?.[1] || fallbackLetter).toUpperCase();
  const body = (match?.[2] || String(option)).trim();
  const canonical = body.toLowerCase().replace(/\s+/g, " ").replace(/[.。]+$/g, "").trim();

  const refs = canonical.replace(/^both\s+/, "").replace(/\band\b/g, ",");
  if (/^[a-e](?:[\s,]+[a-e]){1,4}$/i.test(refs)) {
    return {
      body,
      expansion: [...refs.matchAll(/[a-e]/gi)].map((match) => match[0].toUpperCase()),
      index,
      kind: "combo",
      oldLetter,
    };
  }

  if (/^all of the above$/i.test(canonical)) {
    return { body, expansion: [], index, kind: "all", oldLetter };
  }

  if (/^(?:none|neither) of the above$/i.test(canonical)) {
    return { body, expansion: [], index, kind: "none", oldLetter };
  }

  return { body, expansion: [], index, kind: "ordinary", oldLetter };
}

export function normalizeMetaOptions(options: string[], answer: string) {
  const parsed = options.map(parseOption);
  const byLetter = new Map(parsed.map((option) => [option.oldLetter, option]));
  const expanded = new Set<string>();

  normalizeAnswer(answer)
    .split("")
    .forEach((letter) => {
      const option = byLetter.get(letter);
      if (!option) {
        expanded.add(letter);
        return;
      }
      if (option.kind === "combo") {
        option.expansion.forEach((expandedLetter) => expanded.add(expandedLetter));
        return;
      }
      if (option.kind === "all") {
        parsed
          .filter((candidate) => candidate.index < option.index && candidate.kind === "ordinary")
          .forEach((candidate) => expanded.add(candidate.oldLetter));
        return;
      }
      expanded.add(option.oldLetter);
    });

  const kept = parsed.filter((option) => {
    if (option.kind === "combo" || option.kind === "all") return false;
    if (option.kind === "none" && !expanded.has(option.oldLetter)) return false;
    return true;
  });
  const oldToNew = new Map(kept.map((option, index) => [option.oldLetter, optionLetter(index)]));
  const normalizedAnswer = [...expanded]
    .map((letter) => oldToNew.get(letter))
    .filter((letter): letter is string => Boolean(letter))
    .sort()
    .join("");

  return {
    answer: normalizedAnswer || normalizeAnswer(answer),
    options: kept.map((option, index) => `${optionLetter(index)}. ${option.body}`),
  };
}

export function applyPatch(question: Question, patch?: QuestionPatch): EffectiveQuestion {
  return {
    ...question,
    baseTopic: question.topic,
    baseOptions: question.options,
    baseAnswer: question.answer,
    topic: patch?.topic?.trim() || question.topic,
    options: patch?.options?.length ? patch.options : question.options,
    answer: normalizeAnswer(patch?.answer || question.answer),
    explanation: patch?.explanation,
    patched: Boolean(patch),
  };
}

export function answerToIndexes(answer: string) {
  return new Set(
    normalizeAnswer(answer)
      .split("")
      .map((letter) => letter.charCodeAt(0) - 65)
      .filter((index) => index >= 0),
  );
}

export function selectedAnswerString(indexes: Set<number>) {
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => String.fromCharCode(65 + index))
    .join("");
}

export function isAnswerCorrect(selected: string, correct: string) {
  return normalizeAnswer(selected) === normalizeAnswer(correct);
}

export function reviewPriority(state?: ReviewState, bookmarked = false, hasNote = false) {
  if (!state) return bookmarked || hasNote ? 4 : 0;
  const age = state.lastAnsweredAt
    ? Math.min(14, Math.floor((Date.now() - new Date(state.lastAnsweredAt).getTime()) / 86_400_000))
    : 14;
  return state.wrongCount * 8 + (state.lastResult === false ? 10 : 0) + age + (bookmarked ? 3 : 0) + (hasNote ? 2 : 0);
}

export function deriveReviewStatus(wrongCount: number, correctStreak: number) {
  if (wrongCount === 0 && correctStreak === 0) return "new" as const;
  if (correctStreak >= 2) return "mastered" as const;
  if (wrongCount > 0) return "weak" as const;
  return "new" as const;
}

export function normalizeReviewState(state: ReviewState): ReviewState {
  const status = deriveReviewStatus(Number(state.wrongCount) || 0, Number(state.correctStreak) || 0);
  return state.status === status ? state : { ...state, status };
}

export function hasWrongHistory(state?: ReviewState) {
  return Boolean(state && ((Number(state.wrongCount) || 0) > 0 || state.lastResult === false));
}

export function makeLegacyKey(item: Pick<ImportedLegacyItem, "topic" | "answer">) {
  return `${String(item.topic || "")}|${normalizeAnswer(item.answer)}`;
}

export function findQuestionByLegacyItem(questions: Question[], item: ImportedLegacyItem) {
  const key = makeLegacyKey(item);
  return questions.find((question) => makeLegacyKey(question) === key);
}

export function chapterSortValue(chapter: string) {
  const value = Number(chapter);
  return Number.isFinite(value) ? value : 999;
}
