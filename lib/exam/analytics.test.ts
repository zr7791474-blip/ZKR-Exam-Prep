import { describe, expect, it } from 'vitest';
import type { ExamAttempt, Question, WeakTopic } from '../models/exam';
import {
  aggregateWeakTopics,
  buildLearningReport,
  computeWeakTopics,
  recommendRevisionQuestions,
} from './analytics';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    index: 1,
    prompt: 'Question',
    options: [
      { id: 'a', label: 'A', text: 'A' },
      { id: 'b', label: 'B', text: 'B' },
    ],
    correctOptionId: 'a',
    hasKnownAnswer: true,
    confidence: 'high',
    questionType: 'single_choice',
    answerStatus: 'official_answer',
    verificationLevel: 1,
    subjectTopic: 'Anatomy',
    ...overrides,
  };
}

function attempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  const questions = [
    question({ id: 'q1', subjectTopic: 'Anatomy' }),
    question({ id: 'q2', subjectTopic: 'Physiology', correctOptionId: 'b' }),
  ];
  return {
    id: 'attempt-1',
    examId: 'exam-1',
    examTitle: 'Practice exam',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:10:00.000Z',
    mode: 'exam',
    answers: { q1: 'b', q2: 'a' },
    totalQuestions: 2,
    knownAnswerQuestions: 2,
    unknownAnswerQuestions: 0,
    answeredCount: 2,
    correctCount: 0,
    incorrectCount: 2,
    scorePercentage: 0,
    questionsSnapshot: questions,
    ...overrides,
  };
}

describe('computeWeakTopics', () => {
  it('groups reliable questions by topic and sorts weakest first', () => {
    const questions = [
      question({ id: 'q1', subjectTopic: 'Anatomy' }),
      question({ id: 'q2', subjectTopic: 'Anatomy' }),
      question({ id: 'q3', subjectTopic: 'Physiology', correctOptionId: 'b' }),
    ];
    const topics = computeWeakTopics(questions, { q1: 'a', q2: 'b', q3: 'a' });

    expect(topics).toHaveLength(2);
    expect(topics[0]).toMatchObject({ topic: 'Physiology', accuracy: 0 });
    expect(topics[1]).toMatchObject({
      topic: 'Anatomy',
      incorrectCount: 1,
      totalCount: 2,
      accuracy: 50,
    });
  });

  it('ignores questions without a reliable answer', () => {
    const topics = computeWeakTopics(
      [question({ id: 'proposed', answerStatus: 'ai_proposed' })],
      { proposed: 'b' },
    );
    expect(topics).toHaveLength(0);
  });
});

describe('buildLearningReport', () => {
  it('builds a report that separates reliable scores from AI/disputed items', () => {
    const questions = [
      question({ id: 'right' }),
      question({ id: 'wrong', subjectTopic: 'Physiology', correctOptionId: 'b' }),
      question({ id: 'proposed', answerStatus: 'ai_proposed' }),
      question({ id: 'disputed', answerStatus: 'disputed' }),
    ];
    const report = buildLearningReport(
      attempt({
        questionsSnapshot: questions,
        answers: { right: 'a', wrong: 'a', proposed: 'a', disputed: 'a' },
      }),
    );

    expect(report.reliableScorePercentage).toBe(50);
    expect(report.correctCount).toBe(1);
    expect(report.incorrectCount).toBe(1);
    expect(report.aiProposedCount).toBe(1);
    expect(report.disputedCount).toBe(1);
    expect(report.summary).toContain('Reliable score: 1/2 (50%)');
    expect(report.summary).toContain('AI-proposed');
    expect(report.recommendedQuestionIds).toContain('wrong');
    expect(report.recommendedQuestionIds).toContain('proposed');
    expect(report.recommendedQuestionIds).toContain('disputed');
  });

  it('states clearly when no reliable key exists', () => {
    const report = buildLearningReport(
      attempt({
        questionsSnapshot: [question({ id: 'u', answerStatus: 'unanswered', hasKnownAnswer: false })],
        answers: { u: 'a' },
      }),
    );
    expect(report.reliableScorePercentage).toBeNull();
    expect(report.summary).toContain('No reliable answer key');
  });
});

describe('aggregateWeakTopics', () => {
  it('sums recurring weaknesses across attempts', () => {
    const first: WeakTopic[] = [
      { topic: 'Anatomy', incorrectCount: 2, totalCount: 4, accuracy: 50 },
    ];
    const second: WeakTopic[] = [
      { topic: 'Anatomy', incorrectCount: 1, totalCount: 2, accuracy: 50 },
      { topic: 'Physiology', incorrectCount: 3, totalCount: 3, accuracy: 0 },
    ];

    const aggregated = aggregateWeakTopics([
      attempt({ weakTopics: first }),
      attempt({ id: 'attempt-2', weakTopics: second }),
    ]);

    expect(aggregated[0]).toMatchObject({ topic: 'Physiology', accuracy: 0 });
    expect(aggregated[1]).toMatchObject({
      topic: 'Anatomy',
      incorrectCount: 3,
      totalCount: 6,
      accuracy: 50,
    });
  });
});

describe('recommendRevisionQuestions', () => {
  it('prioritises weak-topic questions, then disputed items, without duplicates', () => {
    const weak = question({ id: 'weak', subjectTopic: 'Anatomy' });
    const other = question({ id: 'other', subjectTopic: 'Physiology' });
    const disputed = question({ id: 'disputed', answerStatus: 'disputed', subjectTopic: 'Other' });

    const result = recommendRevisionQuestions([other, disputed, weak], [
      { topic: 'Anatomy', incorrectCount: 1, totalCount: 1, accuracy: 0 },
    ]);

    expect(result.map((q) => q.id)).toEqual(['weak', 'disputed', 'other']);
    expect(new Set(result.map((q) => q.id)).size).toBe(result.length);
  });

  it('respects the limit', () => {
    const questions = Array.from({ length: 5 }, (_, index) =>
      question({ id: `q${index}`, subjectTopic: 'Anatomy' }),
    );
    const result = recommendRevisionQuestions(questions, [], 3);
    expect(result).toHaveLength(3);
  });
});
