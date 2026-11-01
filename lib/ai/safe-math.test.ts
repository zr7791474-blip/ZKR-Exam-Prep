import { describe, expect, it } from 'vitest';
import type { Question } from '../models/exam';
import {
  evaluateMathExpression,
  extractNumericExpression,
  numericValueOfOption,
  verifyMathQuestion,
} from './safe-math';

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'math',
    index: 1,
    prompt: 'What is 2 + 3 * 4?',
    options: [
      { id: 'a', label: 'A', text: '14' },
      { id: 'b', label: 'B', text: '20' },
      { id: 'c', label: 'C', text: '24' },
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

describe('evaluateMathExpression', () => {
  it('respects precedence, parentheses, unary signs, and powers', () => {
    expect(evaluateMathExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateMathExpression('(2 + 3) * 4')).toBe(20);
    expect(evaluateMathExpression('-3 + 10')).toBe(7);
    expect(evaluateMathExpression('2^3^2')).toBe(512);
    expect(evaluateMathExpression('1,000 + 250')).toBe(1250);
  });

  it('normalises unicode operators', () => {
    expect(evaluateMathExpression('6 × 7')).toBe(42);
    expect(evaluateMathExpression('12 ÷ 4')).toBe(3);
    expect(evaluateMathExpression('10 − 3')).toBe(7);
  });

  it('supports a small function whitelist', () => {
    expect(evaluateMathExpression('sqrt(16)')).toBe(4);
    expect(evaluateMathExpression('abs(-5)')).toBe(5);
    expect(evaluateMathExpression('round(2.6)')).toBe(3);
    expect(evaluateMathExpression('ln(e)')).toBeCloseTo(1);
  });

  it('rejects unsafe or invalid input', () => {
    expect(evaluateMathExpression('process.exit(1)')).toBeNull();
    expect(evaluateMathExpression('alert(1)')).toBeNull();
    expect(evaluateMathExpression('1 / 0')).toBeNull();
    expect(evaluateMathExpression('sqrt(-4)')).toBeNull();
    expect(evaluateMathExpression('2 +')).toBeNull();
    expect(evaluateMathExpression('')).toBeNull();
    expect(evaluateMathExpression('1'.repeat(400))).toBeNull();
  });
});

describe('extractNumericExpression', () => {
  it('extracts percentages and simple word problems', () => {
    expect(extractNumericExpression('What is 25% of 80?')).toBe('(25/100)*80');
    expect(extractNumericExpression('Calculate 12 + 8')).toBe('12 + 8');
    expect(extractNumericExpression('What is 3 times 4?')).toBe('3 * 4');
  });

  it('returns null when no computable expression exists', () => {
    expect(extractNumericExpression('Which city is the capital of France?')).toBeNull();
  });
});

describe('numericValueOfOption', () => {
  it('parses percentages, fractions, and units', () => {
    expect(numericValueOfOption('75%')).toBeCloseTo(0.75);
    expect(numericValueOfOption('3/4')).toBeCloseTo(0.75);
    expect(numericValueOfOption('12 m/s')).toBe(12);
    expect(numericValueOfOption('-2.5')).toBe(-2.5);
  });

  it('returns null for non-numeric text or division by zero', () => {
    expect(numericValueOfOption('Paris')).toBeNull();
    expect(numericValueOfOption('1/0')).toBeNull();
  });
});

describe('verifyMathQuestion', () => {
  it('confirms a proposed answer that matches the computed result', () => {
    const result = verifyMathQuestion(question(), ['A']);
    expect(result).toMatchObject({
      checked: true,
      verified: true,
      computed: 14,
      expectedLabel: 'A',
    });
    expect(result.detail).toContain('confirms A');
  });

  it('flags a proposal that disagrees with the computed result', () => {
    const result = verifyMathQuestion(question(), ['B']);
    expect(result.checked).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.expectedLabel).toBe('A');
    expect(result.detail).toContain('disagrees');
  });

  it('reports checked:false when the question is not safely computable', () => {
    const result = verifyMathQuestion(
      question({ prompt: 'Which city is the capital of France?' }),
      ['A'],
    );
    expect(result.checked).toBe(false);
    expect(result.verified).toBe(false);
  });

  it('reports checked:true, verified:false when no option matches', () => {
    const result = verifyMathQuestion(
      question({
        options: [
          { id: 'a', label: 'A', text: '1' },
          { id: 'b', label: 'B', text: '2' },
        ],
      }),
      ['A'],
    );
    expect(result.checked).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.detail).toContain('no option matches');
  });
});
