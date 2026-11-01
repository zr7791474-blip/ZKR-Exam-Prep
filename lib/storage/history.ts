import type { Exam, ExamAttempt, FlashcardItem } from '../models/exam';

export const ATTEMPTS_STORAGE_KEY = 'zkr:attempts:v2';
export const LEGACY_ATTEMPTS_KEY = 'zkr:attempts';
export const CURRENT_EXAM_KEY = 'zkr:current_exam:v1';
export const FLASHCARDS_KEY = 'zkr:flashcards:v1';
export const MAX_HISTORY_ITEMS = 50;
export const MAX_FLASHCARDS = 500;

/**
 * Validates whether an unknown value conforms to an ExamAttempt shape.
 */
function isValidAttempt(item: unknown): item is ExamAttempt {
  if (!item || typeof item !== 'object') return false;
  const a = item as Partial<ExamAttempt>;
  return (
    typeof a.id === 'string' &&
    typeof a.examTitle === 'string' &&
    typeof a.completedAt === 'string' &&
    typeof a.totalQuestions === 'number' &&
    typeof a.correctCount === 'number' &&
    Array.isArray(a.questionsSnapshot)
  );
}

/**
 * Loads all saved attempts with defensive handling for missing, malformed, or legacy data.
 */
export function loadAttempts(storage: Storage | null = getLocalStorage()): ExamAttempt[] {
  if (!storage) return [];

  // Try modern storage key
  try {
    const raw = storage.getItem(ATTEMPTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(isValidAttempt);
      }
    }
  } catch {
    // Corrupted JSON - continue to check legacy or return empty
  }

  // Fallback: check legacy attempts key
  try {
    const legacyRaw = storage.getItem(LEGACY_ATTEMPTS_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw);
      if (Array.isArray(parsed)) {
        // Adapt legacy { title, score, at } entries safely
        const migrated: ExamAttempt[] = [];
        for (let i = 0; i < parsed.length; i++) {
          const item = parsed[i];
          if (item && typeof item === 'object') {
            migrated.push({
              id: `legacy-${i}-${Date.now()}`,
              examId: 'legacy-exam',
              examTitle: String(item.title || 'Untitled Exam'),
              startedAt: String(item.at || new Date().toISOString()),
              completedAt: String(item.at || new Date().toISOString()),
              mode: 'exam',
              answers: {},
              totalQuestions: 0,
              knownAnswerQuestions: 0,
              unknownAnswerQuestions: 0,
              answeredCount: 0,
              correctCount: 0,
              incorrectCount: 0,
              scorePercentage: null,
              questionsSnapshot: [],
            });
          }
        }
        return migrated;
      }
    }
  } catch {
    // Legacy corrupted as well - safely ignore
  }

  return [];
}

/**
 * Saves a new exam attempt, capping at MAX_HISTORY_ITEMS.
 */
export function saveAttempt(
  attempt: ExamAttempt,
  storage: Storage | null = getLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    const existing = loadAttempts(storage);
    const updated = [attempt, ...existing.filter((a) => a.id !== attempt.id)].slice(
      0,
      MAX_HISTORY_ITEMS,
    );
    storage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(updated));

    // Also update legacy key so existing UI / other tabs see the attempt
    try {
      const legacyItems = updated.map((a) => ({
        title: a.examTitle,
        score:
          a.scorePercentage !== null
            ? `${a.correctCount}/${a.knownAnswerQuestions} (${a.scorePercentage}%)`
            : `${a.answeredCount}/${a.totalQuestions} answered`,
        at: a.completedAt,
      }));
      storage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacyItems));
    } catch {
      // Ignore legacy sync failures
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Loads a single attempt by ID.
 */
export function getAttemptById(
  id: string,
  storage: Storage | null = getLocalStorage(),
): ExamAttempt | null {
  const attempts = loadAttempts(storage);
  return attempts.find((a) => a.id === id) ?? null;
}

/**
 * Removes an attempt by ID.
 */
export function deleteAttempt(
  id: string,
  storage: Storage | null = getLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    const existing = loadAttempts(storage);
    const updated = existing.filter((a) => a.id !== id);
    storage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(updated));
    return true;
  } catch {
    return false;
  }
}

/**
 * Saves the currently loaded active exam into storage for seamless resumption.
 */
export function saveActiveExam(exam: Exam, storage: Storage | null = getLocalStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CURRENT_EXAM_KEY, JSON.stringify(exam));
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads the active exam from storage.
 */
export function loadActiveExam(storage: Storage | null = getLocalStorage()): Exam | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CURRENT_EXAM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
      return parsed as Exam;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clears the active exam from storage.
 */
export function clearActiveExam(storage: Storage | null = getLocalStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(CURRENT_EXAM_KEY);
  } catch {
    // Ignore
  }
}

function isValidFlashcard(item: unknown): item is FlashcardItem {
  if (!item || typeof item !== 'object') return false;
  const card = item as Partial<FlashcardItem>;
  return (
    typeof card.id === 'string' &&
    typeof card.questionId === 'string' &&
    typeof card.prompt === 'string' &&
    typeof card.dueDate === 'string' &&
    typeof card.interval === 'number' &&
    typeof card.easeFactor === 'number'
  );
}

export function loadFlashcards(storage: Storage | null = getLocalStorage()): FlashcardItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(FLASHCARDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidFlashcard);
  } catch {
    return [];
  }
}

export function saveFlashcards(
  cards: readonly FlashcardItem[],
  storage: Storage | null = getLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(FLASHCARDS_KEY, JSON.stringify(cards.slice(0, MAX_FLASHCARDS)));
    return true;
  } catch {
    return false;
  }
}

/** Adds new cards without duplicating an existing question card. */
export function mergeFlashcards(
  existing: readonly FlashcardItem[],
  incoming: readonly FlashcardItem[],
): FlashcardItem[] {
  const byQuestion = new Map(existing.map((card) => [card.questionId, card]));
  for (const card of incoming) {
    if (!byQuestion.has(card.questionId)) byQuestion.set(card.questionId, card);
  }
  return [...byQuestion.values()].slice(0, MAX_FLASHCARDS);
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
