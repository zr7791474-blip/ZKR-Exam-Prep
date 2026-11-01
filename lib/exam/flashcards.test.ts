import { describe, expect, it } from 'vitest';
import type { FlashcardItem, Question } from '../models/exam';
import {
  createFlashcardsFromQuestions,
  dueFlashcards,
  flashcardStats,
  isFlashcardDue,
  reviewFlashcard,
} from './flashcards';

const NOW = new Date('2026-03-10T12:00:00.000Z');

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    index: 1,
    prompt: 'Which city is the capital of France?',
    options: [
      { id: 'a', label: 'A', text: 'London' },
      { id: 'b', label: 'B', text: 'Paris' },
    ],
    correctOptionId: 'b',
    hasKnownAnswer: true,
    confidence: 'high',
    questionType: 'single_choice',
    answerStatus: 'official_answer',
    verificationLevel: 1,
    subjectTopic: 'Geography',
    ...overrides,
  };
}

function card(overrides: Partial<FlashcardItem> = {}): FlashcardItem {
  return {
    id: 'fc-q1',
    questionId: 'q1',
    prompt: 'Question',
    options: [],
    correctOptionId: 'b',
    interval: 0,
    repetition: 0,
    easeFactor: 2.5,
    dueDate: '2026-03-10',
    ...overrides,
  };
}

describe('createFlashcardsFromQuestions', () => {
  it('creates cards only from questions with a defensible answer', () => {
    const cards = createFlashcardsFromQuestions(
      [
        question({ id: 'official' }),
        question({ id: 'proposed', answerStatus: 'ai_proposed' }),
        question({ id: 'disputed', answerStatus: 'disputed' }),
        question({ id: 'free', questionType: 'free_response', options: [], acceptedAnswers: ['Paris'] }),
      ],
      NOW,
    );

    expect(cards.map((c) => c.questionId)).toEqual(['official', 'proposed', 'free']);
    expect(cards[0].dueDate).toBe('2026-03-10');
    expect(cards[0].easeFactor).toBe(2.5);
    expect(cards[0].interval).toBe(0);
    expect(cards[0].subjectTopic).toBe('Geography');
  });

  it('carries multi-answer keys and AI explanations', () => {
    const [created] = createFlashcardsFromQuestions(
      [
        question({
          id: 'multi',
          correctOptionIds: ['a', 'b'],
          aiSolution: {
            answer: 'A, B',
            answerText: '',
            explanation: 'Both apply.',
            optionAnalysis: [],
            confidence: 'high',
            status: 'ai_verified',
            verificationLevel: 3,
          },
        }),
      ],
      NOW,
    );
    expect(created.correctOptionIds).toEqual(['a', 'b']);
    expect(created.explanation).toBe('Both apply.');
  });
});

describe('reviewFlashcard', () => {
  it('resets the interval on "again"', () => {
    const reviewed = reviewFlashcard(
      card({ interval: 20, repetition: 4, easeFactor: 2.5 }),
      'again',
      NOW,
    );
    expect(reviewed.repetition).toBe(0);
    expect(reviewed.interval).toBe(1);
    expect(reviewed.easeFactor).toBe(2.3);
    expect(reviewed.dueDate).toBe('2026-03-11');
    expect(reviewed.lastReviewed).toBe(NOW.toISOString());
  });

  it('grows the interval on "good" (1 day, then 6 days)', () => {
    const first = reviewFlashcard(card(), 'good', NOW);
    expect(first.interval).toBe(1);
    expect(first.repetition).toBe(1);

    const second = reviewFlashcard(first, 'good', NOW);
    expect(second.interval).toBe(6);
    expect(second.repetition).toBe(2);

    const third = reviewFlashcard(second, 'good', NOW);
    expect(third.interval).toBe(15); // round(6 * 2.5)
  });

  it('keeps ease within bounds for hard and easy grades', () => {
    const hard = reviewFlashcard(card({ easeFactor: 1.3 }), 'hard', NOW);
    expect(hard.easeFactor).toBe(1.3);
    expect(hard.interval).toBeGreaterThanOrEqual(1);

    const easy = reviewFlashcard(card({ easeFactor: 3 }), 'easy', NOW);
    expect(easy.easeFactor).toBe(3);
    expect(easy.interval).toBeGreaterThanOrEqual(2);
  });
});

describe('due scheduling', () => {
  it('detects cards due on or before today', () => {
    expect(isFlashcardDue(card({ dueDate: '2026-03-09' }), NOW)).toBe(true);
    expect(isFlashcardDue(card({ dueDate: '2026-03-10' }), NOW)).toBe(true);
    expect(isFlashcardDue(card({ dueDate: '2026-03-11' }), NOW)).toBe(false);
  });

  it('filters due cards and computes stats', () => {
    const cards = [
      card({ id: 'due', dueDate: '2026-03-01', lastReviewed: '2026-02-28T00:00:00.000Z' }),
      card({ id: 'later', dueDate: '2026-04-01' }),
    ];

    expect(dueFlashcards(cards, NOW).map((c) => c.id)).toEqual(['due']);
    expect(flashcardStats(cards, NOW)).toEqual({
      total: 2,
      due: 1,
      reviewed: 1,
      averageEase: 2.5,
    });
    expect(flashcardStats([], NOW)).toEqual({ total: 0, due: 0, reviewed: 0, averageEase: 0 });
  });
});
