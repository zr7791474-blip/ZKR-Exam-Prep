import { describe, expect, it } from 'vitest';
import type { Question } from '../models/exam';
import { formatScoreSummary, scoreAttempt } from './scoring';

describe('scoreAttempt', () => {
  const q1: Question = {
    id: 'q1',
    index: 1,
    prompt: 'Question 1',
    options: [
      { id: 'q1-a', label: 'A', text: 'Option A', isCorrect: true },
      { id: 'q1-b', label: 'B', text: 'Option B', isCorrect: false },
    ],
    correctOptionId: 'q1-a',
    hasKnownAnswer: true,
    confidence: 'high',
    answerStatus: 'official_answer',
    verificationLevel: 1,
  };

  const q2: Question = {
    id: 'q2',
    index: 2,
    prompt: 'Question 2',
    options: [
      { id: 'q2-a', label: 'A', text: 'Option A', isCorrect: false },
      { id: 'q2-b', label: 'B', text: 'Option B', isCorrect: true },
    ],
    correctOptionId: 'q2-b',
    hasKnownAnswer: true,
    confidence: 'high',
    answerStatus: 'official_answer',
    verificationLevel: 1,
  };

  const q3Unknown: Question = {
    id: 'q3',
    index: 3,
    prompt: 'Question 3 (No known answer in source document)',
    options: [
      { id: 'q3-a', label: 'A', text: 'Option A' },
      { id: 'q3-b', label: 'B', text: 'Option B' },
    ],
    correctOptionId: null,
    hasKnownAnswer: false,
    confidence: 'medium',
    answerStatus: 'unanswered',
    verificationLevel: 1,
  };

  it('calculates 100% score when all known questions are correct', () => {
    const summary = scoreAttempt([q1, q2], {
      q1: 'q1-a',
      q2: 'q2-b',
    });

    expect(summary.totalQuestions).toBe(2);
    expect(summary.knownAnswerQuestions).toBe(2);
    expect(summary.correctCount).toBe(2);
    expect(summary.incorrectCount).toBe(0);
    expect(summary.scorePercentage).toBe(100);
    expect(summary.mistakes).toHaveLength(0);
  });

  it('accurately records mistakes and calculates percentage', () => {
    const summary = scoreAttempt([q1, q2], {
      q1: 'q1-b', // Incorrect
      q2: 'q2-b', // Correct
    });

    expect(summary.correctCount).toBe(1);
    expect(summary.incorrectCount).toBe(1);
    expect(summary.scorePercentage).toBe(50);
    expect(summary.mistakes).toHaveLength(1);
    expect(summary.mistakes[0].question.id).toBe('q1');
    expect(summary.mistakes[0].selectedOptionId).toBe('q1-b');
    expect(summary.mistakes[0].correctOptionId).toBe('q1-a');
    expect(summary.mistakes[0].isUnanswered).toBe(false);
  });

  it('treats unanswered questions with known answers as mistakes', () => {
    const summary = scoreAttempt([q1, q2], {
      q1: 'q1-a',
      // q2 is not answered
    });

    expect(summary.unansweredCount).toBe(1);
    expect(summary.correctCount).toBe(1);
    expect(summary.incorrectCount).toBe(1);
    expect(summary.mistakes).toHaveLength(1);
    expect(summary.mistakes[0].isUnanswered).toBe(true);
  });

  it('distinguishes known vs unknown questions in score percentage', () => {
    const summary = scoreAttempt([q1, q2, q3Unknown], {
      q1: 'q1-a', // Correct (1/2)
      q2: 'q2-a', // Incorrect (0/2)
      q3: 'q3-a', // Answered, but answer is unkeyed
    });

    expect(summary.totalQuestions).toBe(3);
    expect(summary.knownAnswerQuestions).toBe(2);
    expect(summary.unknownAnswerQuestions).toBe(1);
    expect(summary.answeredCount).toBe(3);
    // Score should be 1 out of 2 known questions = 50%, NOT 1 out of 3
    expect(summary.correctCount).toBe(1);
    expect(summary.scorePercentage).toBe(50);
  });

  it('returns null scorePercentage when no questions have known answers', () => {
    const summary = scoreAttempt([q3Unknown], {
      q3: 'q3-a',
    });

    expect(summary.knownAnswerQuestions).toBe(0);
    expect(summary.unknownAnswerQuestions).toBe(1);
    expect(summary.scorePercentage).toBeNull();
    expect(formatScoreSummary(summary)).toContain('no verified answer key');
  });

  it('formats score summary appropriately', () => {
    const summary = scoreAttempt([q1, q2], { q1: 'q1-a', q2: 'q2-b' });
    expect(formatScoreSummary(summary)).toBe('2/2 (100%)');
  });
});
