import { describe, expect, it } from 'vitest';
import type { Question } from '../models/exam';
import { scoreAttempt } from './scoring';
import { shuffleArray, shuffleExercise, shuffleQuestionOptions, shuffleQuestions } from './shuffle';

function createMockQuestion(index: number, correctIdx: number): Question {
  const options = ['Option 1', 'Option 2', 'Option 3', 'Option 4'].map((text, i) => ({
    id: `q${index}-opt-${i + 1}`,
    label: String.fromCharCode(65 + i),
    text,
    isCorrect: i === correctIdx,
  }));

  return {
    id: `q-${index}`,
    index,
    prompt: `Question prompt ${index}`,
    options,
    correctOptionId: options[correctIdx].id,
    hasKnownAnswer: true,
    confidence: 'high',
    answerStatus: 'official_answer',
    verificationLevel: 1,
  };
}

describe('Shuffle exercises and answer preservation', () => {
  it('shuffleArray preserves all elements', () => {
    const original = [1, 2, 3, 4, 5];
    const shuffled = shuffleArray(original);
    expect(shuffled).toHaveLength(5);
    expect(shuffled.sort()).toEqual(original);
  });

  it('shuffleQuestions preserves question IDs and re-indexes sequentially', () => {
    const questions = [
      createMockQuestion(1, 0),
      createMockQuestion(2, 1),
      createMockQuestion(3, 2),
      createMockQuestion(4, 3),
    ];

    // Seeded reverse RNG: always picks index 0
    const reversed = shuffleQuestions(questions, () => 0);
    expect(reversed).toHaveLength(4);
    expect(reversed[0].index).toBe(1);
    expect(reversed[1].index).toBe(2);
    expect(reversed[2].index).toBe(3);
    expect(reversed[3].index).toBe(4);

    const ids = reversed.map((q) => q.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('shuffleQuestionOptions preserves correctOptionId and isCorrect mapping', () => {
    const question = createMockQuestion(1, 1); // Option 2 (id: q1-opt-2) is correct
    const originalCorrectOption = question.options.find((o) => o.isCorrect === true);
    expect(originalCorrectOption?.id).toBe('q1-opt-2');

    // Shuffle options using an arbitrary mock RNG
    const shuffled = shuffleQuestionOptions(question, () => 0.7);

    // All 4 options are preserved
    expect(shuffled.options).toHaveLength(4);

    // The option that was originally correct is still marked isCorrect
    const shuffledCorrectOption = shuffled.options.find((o) => o.isCorrect === true);
    expect(shuffledCorrectOption).toBeDefined();
    expect(shuffledCorrectOption?.id).toBe('q1-opt-2');
    expect(shuffledCorrectOption?.text).toBe('Option 2');

    // question.correctOptionId still points to the correct option ID
    expect(shuffled.correctOptionId).toBe('q1-opt-2');
  });

  it('scoring yields the exact same result before and after full exercise shuffle', () => {
    const questions = [
      createMockQuestion(1, 0), // correct: opt-1
      createMockQuestion(2, 2), // correct: opt-3
      createMockQuestion(3, 1), // correct: opt-2
    ];

    // User selects correct answer for Q1 and Q2, wrong for Q3
    const answers: Record<string, string | null> = {
      'q-1': 'q1-opt-1', // Correct
      'q-2': 'q2-opt-3', // Correct
      'q-3': 'q3-opt-4', // Wrong (correct was opt-2)
    };

    const originalScore = scoreAttempt(questions, answers);
    expect(originalScore.correctCount).toBe(2);
    expect(originalScore.incorrectCount).toBe(1);
    expect(originalScore.scorePercentage).toBe(67);

    // Now shuffle both questions and options
    const shuffled = shuffleExercise(questions);

    // Evaluate same answers on shuffled exam
    const shuffledScore = scoreAttempt(shuffled, answers);
    expect(shuffledScore.correctCount).toBe(originalScore.correctCount);
    expect(shuffledScore.incorrectCount).toBe(originalScore.incorrectCount);
    expect(shuffledScore.scorePercentage).toBe(originalScore.scorePercentage);
  });
});
