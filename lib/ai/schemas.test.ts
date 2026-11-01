import { describe, expect, it } from 'vitest';
import {
  labelsToOptionIds,
  questionInputSchema,
  solveRequestSchema,
  validateSolutionForQuestion,
} from './schemas';

const options = [
  { id: 'a', label: 'A', text: 'London' },
  { id: 'b', label: 'B', text: 'Paris' },
  { id: 'c', label: 'C', text: 'Berlin' },
];

const singleChoice = {
  prompt: 'What is the capital of France?',
  options,
  questionType: 'single_choice' as const,
  acceptedAnswers: undefined,
  hasKnownAnswer: false,
  correctOptionId: null,
};

describe('validateSolutionForQuestion', () => {
  it('accepts a valid single-choice solution', () => {
    const result = validateSolutionForQuestion(
      { answer: 'B', explanation: 'Paris is the capital of France.', confidence: 'high' },
      singleChoice,
    );
    expect(result.ok).toBe(true);
    expect(result.solution?.answer).toBe('B');
    expect(result.errors).toEqual([]);
  });

  it('rejects an option label that does not exist', () => {
    const result = validateSolutionForQuestion(
      { answer: 'D', explanation: 'A guess.', confidence: 'low' },
      singleChoice,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('does not exist');
  });

  it('rejects multiple answers for a single-choice question', () => {
    const result = validateSolutionForQuestion(
      {
        answer: 'A',
        answers: ['A', 'B'],
        explanation: 'Two answers.',
        confidence: 'medium',
      },
      singleChoice,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('exactly one answer');
  });

  it('accepts multiple answers for a multiple-choice question', () => {
    const result = validateSolutionForQuestion(
      {
        answers: ['A', 'C'],
        answer: 'A, C',
        explanation: 'Both are correct.',
        confidence: 'high',
      },
      { ...singleChoice, questionType: 'multiple_choice' },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects option analysis for labels that do not exist', () => {
    const result = validateSolutionForQuestion(
      {
        answer: 'B',
        explanation: 'Paris.',
        confidence: 'high',
        optionAnalysis: [{ option: 'Z', isCorrect: false, reason: 'Unknown option.' }],
      },
      singleChoice,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('unsupported label');
  });

  it('accepts a free-response solution with answer text', () => {
    const result = validateSolutionForQuestion(
      {
        answer: 'Paris',
        answerText: 'Paris',
        explanation: 'Paris is the capital.',
        confidence: 'high',
      },
      {
        prompt: 'Name the capital of France.',
        options: [],
        questionType: 'free_response',
        acceptedAnswers: ['Paris'],
        hasKnownAnswer: false,
        correctOptionId: null,
      },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects malformed model output', () => {
    const result = validateSolutionForQuestion({ answer: '', explanation: '' }, singleChoice);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe('labelsToOptionIds', () => {
  it('maps labels to option IDs and drops unknown labels', () => {
    expect(labelsToOptionIds(['A', 'C', 'Z'], options)).toEqual(['a', 'c']);
  });
});

describe('request schemas', () => {
  it('strips unknown client fields such as aiSolution', () => {
    const parsed = questionInputSchema.parse({
      id: 'q1',
      index: 1,
      prompt: 'Question?',
      options,
      aiSolution: { answer: 'Z', explanation: 'Injected' },
      unknownField: true,
    });
    expect(parsed).not.toHaveProperty('aiSolution');
    expect(parsed).not.toHaveProperty('unknownField');
  });

  it('applies safe defaults to solve requests', () => {
    const parsed = solveRequestSchema.parse({
      questions: [{ id: 'q1', index: 1, prompt: 'Question?', options }],
    });
    expect(parsed.checkOfficialAnswers).toBe(false);
    expect(parsed.maxQuestions).toBe(30);
  });

  it('rejects empty solve requests', () => {
    expect(solveRequestSchema.safeParse({ questions: [] }).success).toBe(false);
  });
});
