import type { FlashcardItem, Question } from '../models/exam';
import { isReliableAnswer } from './scoring';

export type FlashcardGrade = 'again' | 'hard' | 'good' | 'easy';

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): string {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy.toISOString().slice(0, 10);
}

/** Creates flashcards only from questions that have a defensible answer. */
export function createFlashcardsFromQuestions(
  questions: readonly Question[],
  now = new Date(),
): FlashcardItem[] {
  return questions
    .filter(
      (q) =>
        isReliableAnswer(q) ||
        q.answerStatus === 'ai_proposed' ||
        (q.acceptedAnswers?.length ?? 0) > 0,
    )
    .map((q) => ({
      id: `fc-${q.id}`,
      questionId: q.id,
      prompt: q.prompt,
      options: q.options,
      correctOptionId: q.correctOptionId,
      ...(q.correctOptionIds?.length ? { correctOptionIds: q.correctOptionIds } : {}),
      explanation: q.explanation ?? q.aiSolution?.explanation,
      subjectTopic: q.subjectTopic,
      answerStatus: q.answerStatus,
      verificationLevel: q.verificationLevel,
      interval: 0,
      repetition: 0,
      easeFactor: 2.5,
      dueDate: todayIso(now),
      createdAt: now.toISOString(),
    }));
}

/**
 * SM-2 style scheduling. `again` resets the interval; the other grades grow it.
 * Dates are stored as UTC YYYY-MM-DD so scheduling survives timezone changes.
 */
export function reviewFlashcard(
  card: FlashcardItem,
  grade: FlashcardGrade,
  now = new Date(),
): FlashcardItem {
  let interval = card.interval;
  let repetition = card.repetition;
  let easeFactor = card.easeFactor;

  switch (grade) {
    case 'again':
      repetition = 0;
      interval = 1;
      easeFactor = Math.max(1.3, easeFactor - 0.2);
      break;
    case 'hard':
      repetition += 1;
      interval = Math.max(1, Math.round(Math.max(1, interval) * 1.2));
      easeFactor = Math.max(1.3, easeFactor - 0.15);
      break;
    case 'good':
      repetition += 1;
      interval = repetition === 1 ? 1 : repetition === 2 ? 6 : Math.max(1, Math.round(interval * easeFactor));
      break;
    case 'easy':
      repetition += 1;
      interval = Math.max(2, Math.round(Math.max(1, interval) * easeFactor * 1.3));
      easeFactor = Math.min(3.0, easeFactor + 0.15);
      break;
  }

  return {
    ...card,
    interval,
    repetition,
    easeFactor: Number(easeFactor.toFixed(2)),
    dueDate: addDays(now, interval),
    lastReviewed: now.toISOString(),
  };
}

export function isFlashcardDue(card: FlashcardItem, now = new Date()): boolean {
  return card.dueDate <= todayIso(now);
}

export function dueFlashcards(cards: readonly FlashcardItem[], now = new Date()): FlashcardItem[] {
  return cards.filter((card) => isFlashcardDue(card, now));
}

export interface FlashcardStats {
  total: number;
  due: number;
  reviewed: number;
  averageEase: number;
}

export function flashcardStats(cards: readonly FlashcardItem[], now = new Date()): FlashcardStats {
  const reviewed = cards.filter((card) => Boolean(card.lastReviewed));
  return {
    total: cards.length,
    due: dueFlashcards(cards, now).length,
    reviewed: reviewed.length,
    averageEase:
      cards.length > 0
        ? Number((cards.reduce((sum, card) => sum + card.easeFactor, 0) / cards.length).toFixed(2))
        : 0,
  };
}
