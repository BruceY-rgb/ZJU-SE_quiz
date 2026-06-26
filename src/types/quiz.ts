export type Answer = string;

export type RawQuestion = {
  topic: string;
  answer: Answer;
  options: string[];
};

export type Question = RawQuestion & {
  id: string;
  chapter: string;
  number: number;
};

export type QuestionPatch = {
  questionId: string;
  topic?: string;
  options?: string[];
  answer?: Answer;
  explanation?: string;
  updatedAt: string;
};

export type EffectiveQuestion = Question & {
  baseTopic: string;
  baseOptions: string[];
  baseAnswer: Answer;
  explanation?: string;
  patched: boolean;
};

export type Attempt = {
  id: string;
  sessionId: string;
  questionId: string;
  chapter: string;
  selectedAnswer: Answer;
  correctAnswerSnapshot: Answer;
  isCorrect: boolean;
  answeredAt: string;
  durationMs: number;
  mode: QuizMode;
};

export type QuizMode = "all" | "single" | "range" | "wrong" | "bookmarks" | "review" | "miniTest" | "sessionWrong" | "sessionBookmarks";

export type QuizSession = {
  id: string;
  mode: QuizMode;
  filters: {
    chapter?: string;
    rangeStart?: number;
    rangeEnd?: number;
    sourceSessionId?: string;
  };
  questionIds: string[];
  startedAt: string;
  finishedAt?: string;
  total: number;
  answered: number;
  correct: number;
};

export type ReviewStatus = "new" | "weak" | "mastered";

export type ReviewState = {
  questionId: string;
  attemptCount: number;
  wrongCount: number;
  correctStreak: number;
  lastAnsweredAt?: string;
  lastResult?: boolean;
  status: ReviewStatus;
};

export type Note = {
  questionId: string;
  content: string;
  updatedAt: string;
};

export type Bookmark = {
  questionId: string;
  createdAt: string;
};

export type ShortAnswerCard = {
  id: string;
  title: string;
  prompt: string;
  group: string;
  points: string[];
  images: Array<{
    alt: string;
    src: string;
  }>;
  sourceOrder: number;
};

export type ShortAnswerRating = "known" | "fuzzy" | "unknown";

export type ShortAnswerStatus = "new" | "weak" | "mastered";

export type ShortAnswerAttempt = {
  id: string;
  cardId: string;
  response: string;
  rating: ShortAnswerRating;
  answeredAt: string;
  durationMs: number;
};

export type ShortAnswerState = {
  cardId: string;
  attemptCount: number;
  knownStreak: number;
  lastRating?: ShortAnswerRating;
  status: ShortAnswerStatus;
  lastAnsweredAt?: string;
};

export type ShortAnswerBookmark = {
  cardId: string;
  createdAt: string;
};

export type ShortAnswerNote = {
  cardId: string;
  content: string;
  updatedAt: string;
};

export type StoredSnapshot = {
  attempts: Attempt[];
  bookmarks: Bookmark[];
  notes: Note[];
  patches: QuestionPatch[];
  reviewStates: ReviewState[];
  sessions: QuizSession[];
  shortAnswerAttempts: ShortAnswerAttempt[];
  shortAnswerBookmarks: ShortAnswerBookmark[];
  shortAnswerNotes: ShortAnswerNote[];
  shortAnswerStates: ShortAnswerState[];
};

export type StoredEnvelope = {
  schemaVersion: 1;
  updatedAt: string;
  data: StoredSnapshot;
};

export type ImportedLegacyItem = {
  chapter?: string;
  topic?: string;
  answer?: string;
  options?: string[];
  userAnswer?: string;
  wrongCount?: number;
  lastWrongAt?: string;
};
