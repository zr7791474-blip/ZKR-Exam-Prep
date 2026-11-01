import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Question } from '../models/exam';
import { clearAICache } from './cache';
import type { ProviderClient } from './provider';
import { solveQuestions } from './solve-question';

function provider(
  answer: string,
  options: { name?: string; model?: string; explanation?: string } = {},
): ProviderClient {
  return {
    name: options.name ?? 'mock',
    model: options.model ?? 'mock-model',
    chat: vi.fn(async () =>
      JSON.stringify({
        answer,
        explanation: options.explanation ?? 'Because the evidence supports this answer.',
        confidence: 'high',
        optionAnalysis: [],
      }),
    ),
  };
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    index: 1,
    prompt: 'Which city is the capital of France?',
    options: [
      { id: 'a', label: 'A', text: 'London' },
      { id: 'b', label: 'B', text: 'Paris' },
      { id: 'c', label: 'C', text: 'Berlin' },
    ],
    correctOptionId: null,
    hasKnownAnswer: false,
    confidence: 'high',
    questionType: 'single_choice',
    answerStatus: 'unanswered',
    verificationLevel: 1,
    ...overrides,
  };
}

beforeEach(() => {
  clearAICache();
});

describe('solveQuestions', () => {
  it('keeps an unverified answer as an AI proposal excluded from scoring', async () => {
    const result = await solveQuestions([question()], {
      provider: provider('B'),
      verifier: null,
      useCache: false,
    });

    const solved = result.questions[0];
    expect(solved.answerStatus).toBe('ai_proposed');
    expect(solved.verificationLevel).toBe(2);
    expect(solved.hasKnownAnswer).toBe(false);
    expect(solved.correctOptionId).toBeNull();
    expect(solved.aiSolution?.answer).toBe('B');
    expect(result.solvedCount).toBe(1);
    expect(result.verifiedCount).toBe(0);
  });

  it('uses deterministic arithmetic as genuine level-3 verification', async () => {
    const mathQuestion = question({
      id: 'math',
      prompt: 'What is 2 + 3?',
      options: [
        { id: 'a', label: 'A', text: '4' },
        { id: 'b', label: 'B', text: '5' },
        { id: 'c', label: 'C', text: '6' },
        { id: 'd', label: 'D', text: '7' },
      ],
    });

    const result = await solveQuestions([mathQuestion], {
      provider: provider('B'),
      verifier: null,
      useCache: false,
    });

    const solved = result.questions[0];
    expect(solved.answerStatus).toBe('ai_verified');
    expect(solved.verificationLevel).toBe(3);
    expect(solved.hasKnownAnswer).toBe(true);
    expect(solved.correctOptionId).toBe('b');
    expect(solved.aiSolution?.verificationMethod).toContain('deterministic');
    expect(result.verifiedCount).toBe(1);
  });

  it('treats a different verifier model as independent verification', async () => {
    const primary = provider('B', { name: 'mock', model: 'primary-model' });
    const verifier = provider('B', { name: 'mock', model: 'verifier-model' });

    const result = await solveQuestions([question()], {
      provider: primary,
      verifier,
      useCache: false,
    });

    const solved = result.questions[0];
    expect(solved.answerStatus).toBe('ai_verified');
    expect(solved.verificationLevel).toBe(3);
    expect(solved.aiSolution?.verificationMethod).toContain('independent');
    expect(result.verifiedCount).toBe(1);
  });

  it('reports a same-model second pass as self-consistency, not independence', async () => {
    const primary = provider('B', { name: 'mock', model: 'same-model' });
    const verifier = provider('B', { name: 'mock', model: 'same-model' });

    const result = await solveQuestions([question()], {
      provider: primary,
      verifier,
      useCache: false,
    });

    const solved = result.questions[0];
    expect(solved.answerStatus).toBe('ai_proposed');
    expect(solved.verificationLevel).toBe(2);
    expect(solved.aiSolution?.verificationMethod).toContain('self-consistency');
    expect(result.verifiedCount).toBe(0);
  });

  it('marks a disagreement with the official answer as disputed and preserves the key', async () => {
    const keyed = question({
      id: 'keyed',
      answerStatus: 'official_answer',
      verificationLevel: 1,
      hasKnownAnswer: true,
      correctOptionId: 'a',
      officialCorrectOptionId: 'a',
      officialAnswerLabel: 'A',
    });

    const result = await solveQuestions([keyed], {
      provider: provider('B'),
      verifier: null,
      checkOfficialAnswers: true,
      useCache: false,
    });

    const solved = result.questions[0];
    expect(solved.answerStatus).toBe('disputed');
    expect(solved.correctOptionId).toBe('a');
    expect(solved.hasKnownAnswer).toBe(true);
    expect(solved.disputeExplanation).toContain('Official source answer: A');
    expect(result.disputedCount).toBe(1);
  });

  it('keeps the official answer when the AI agrees with it', async () => {
    const keyed = question({
      id: 'agrees',
      answerStatus: 'official_answer',
      hasKnownAnswer: true,
      correctOptionId: 'b',
      officialCorrectOptionId: 'b',
      officialAnswerLabel: 'B',
    });

    const result = await solveQuestions([keyed], {
      provider: provider('B'),
      verifier: null,
      checkOfficialAnswers: true,
      useCache: false,
    });

    const solved = result.questions[0];
    expect(solved.answerStatus).toBe('official_answer');
    expect(solved.correctOptionId).toBe('b');
    expect(solved.disputeExplanation).toBeUndefined();
  });

  it('skips diagram questions instead of guessing', async () => {
    const diagram = question({ id: 'diagram', hasDiagram: true });
    const primary = provider('B');

    const result = await solveQuestions([diagram], {
      provider: primary,
      verifier: null,
      useCache: false,
    });

    expect(result.solvedCount).toBe(0);
    expect(result.warnings.join(' ')).toContain('diagram');
    expect(primary.chat).not.toHaveBeenCalled();
  });

  it('throws when no provider is configured', async () => {
    await expect(solveQuestions([question()], { provider: null })).rejects.toMatchObject({
      code: 'MISSING_KEY',
    });
  });
});
