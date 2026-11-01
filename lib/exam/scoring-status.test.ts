import { describe, expect, it } from 'vitest';
import type { Question } from '../models/exam';
import { formatScoreSummary, isReliableAnswer, scoreAttempt } from './scoring';

function mcq(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    index: 1,
    prompt: 'Which city is the capital of France?',
    options: [
      { id: 'a', label: 'A', text: 'London' },
      { id: 'b', label: 'B', text: 'Paris' },
      { id: 'c', label: 'C', text: 'Berlin' },
    ],
    correctOptionId: 'b',
    hasKnownAnswer: true,
    confidence: 'high',
    questionType: 'single_choice',
    answerStatus: 'official_answer',
    verificationLevel: 1,
    ...overrides,
  };
}

describe('isReliableAnswer', () => {
  it('trusts official, user-confirmed, and AI-verified keys', () => {
    expect(isReliableAnswer(mcq({ answerStatus: 'official_answer' }))).toBe(true);
    expect(isReliableAnswer(mcq({ answerStatus: 'user_confirmed' }))).toBe(true);
    expect(isReliableAnswer(mcq({ answerStatus: 'ai_verified', verificationLevel: 3 }))).toBe(true);
  });

  it('does not trust AI proposals, disputes, or unanswered items', () => {
    expect(isReliableAnswer(mcq({ answerStatus: 'ai_proposed' }))).toBe(false);
    expect(isReliableAnswer(mcq({ answerStatus: 'disputed' }))).toBe(false);
    expect(isReliableAnswer(mcq({ answerStatus: 'needs_review' }))).toBe(false);
    expect(isReliableAnswer(mcq({ answerStatus: 'unanswered' }))).toBe(false);
  });

  it('falls back to key presence for legacy questions without a status', () => {
    const legacy = mcq();
    delete (legacy as { answerStatus?: Question['answerStatus'] }).answerStatus;
    expect(isReliableAnswer(legacy)).toBe(true);

    const legacyUnkeyed = { ...legacy, correctOptionId: null, hasKnownAnswer: false };
    expect(isReliableAnswer(legacyUnkeyed)).toBe(false);
  });
});

describe('scoreAttempt with answer statuses', () => {
  it('excludes AI-proposed answers from the objective score and reports them', () => {
    const summary = scoreAttempt(
      [mcq({ id: 'official' }), mcq({ id: 'proposed', answerStatus: 'ai_proposed' })],
      { official: 'b', proposed: 'b' },
    );

    expect(summary.knownAnswerQuestions).toBe(1);
    expect(summary.correctCount).toBe(1);
    expect(summary.scorePercentage).toBe(100);
    expect(summary.aiProposedQuestions).toBe(1);
    expect(summary.unknownAnswerQuestions).toBe(1);
    expect(formatScoreSummary(summary)).toContain('AI-proposed (excluded)');
  });

  it('excludes disputed keys from scoring but still preserves the official key for review', () => {
    const disputed = mcq({ id: 'disputed', answerStatus: 'disputed', officialCorrectOptionId: 'b' });
    const summary = scoreAttempt([disputed], { disputed: 'c' });

    expect(summary.knownAnswerQuestions).toBe(0);
    expect(summary.scorePercentage).toBeNull();
    expect(summary.disputedQuestions).toBe(1);
    expect(summary.mistakes).toHaveLength(0);
    expect(disputed.correctOptionId).toBe('b');
    expect(formatScoreSummary(summary)).toContain('no verified answer key');
  });

  it('reports needs-review questions separately without scoring them', () => {
    const summary = scoreAttempt([mcq({ id: 'review', answerStatus: 'needs_review' })], {
      review: 'b',
    });
    expect(summary.needsReviewQuestions).toBe(1);
    expect(summary.scorePercentage).toBeNull();
  });

  it('scores multiple-answer questions only on an exact set match', () => {
    const multi = mcq({
      id: 'multi',
      questionType: 'multiple_choice',
      correctOptionId: null,
      correctOptionIds: ['a', 'c'],
      answerStatus: 'official_answer',
    });

    const exact = scoreAttempt([multi], { multi: ['c', 'a'] });
    expect(exact.correctCount).toBe(1);
    expect(exact.scorePercentage).toBe(100);

    const partial = scoreAttempt([multi], { multi: ['a'] });
    expect(partial.incorrectCount).toBe(1);
    expect(partial.mistakes[0].correctOptionIds).toEqual(['a', 'c']);
  });

  it('normalises free-response answers and counts them as a distinct category', () => {
    const free = mcq({
      id: 'free',
      questionType: 'free_response',
      options: [],
      correctOptionId: null,
      acceptedAnswers: ['Paris'],
      answerStatus: 'official_answer',
    });

    const summary = scoreAttempt([free], {}, { free: '  paris. ' });
    expect(summary.freeResponseQuestions).toBe(1);
    expect(summary.correctCount).toBe(1);
    expect(summary.answeredCount).toBe(1);

    const wrong = scoreAttempt([free], {}, { free: 'London' });
    expect(wrong.incorrectCount).toBe(1);
    expect(wrong.mistakes[0].isUnanswered).toBe(false);
  });

  it('summarises disputed counts in the human-readable summary', () => {
    const summary = scoreAttempt(
      [mcq({ id: 'ok' }), mcq({ id: 'bad', answerStatus: 'disputed' })],
      { ok: 'b', bad: 'b' },
    );
    expect(formatScoreSummary(summary)).toBe('1/1 (100%) — 1 unkeyed, 1 disputed (excluded)');
  });
});
