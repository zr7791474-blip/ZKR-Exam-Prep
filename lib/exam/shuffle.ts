import type { Question, QuestionOption } from '../models/exam';

const DEFAULT_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/**
 * Standard Fisher-Yates array shuffle with optional deterministic RNG.
 */
export function shuffleArray<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

/**
 * Shuffles the options of a question while preserving:
 * 1. The original option id and isCorrect flag
 * 2. The question's correctOptionId pointer
 * 3. Re-labels options sequentially (A, B, C, ...) to maintain a natural presentation
 */
export function shuffleQuestionOptions(
  question: Question,
  rng: () => number = Math.random,
): Question {
  const shuffled = shuffleArray(question.options, rng);

  const remappedOptions: QuestionOption[] = shuffled.map((opt, index) => ({
    ...opt,
    label: DEFAULT_LABELS[index] ?? String(index + 1),
  }));

  // Verify correctOptionId still matches the option that has isCorrect = true
  let resolvedCorrectId = question.correctOptionId;
  const correctOpt = remappedOptions.find((o) => o.isCorrect === true);
  if (correctOpt) {
    resolvedCorrectId = correctOpt.id;
  }

  return {
    ...question,
    options: remappedOptions,
    correctOptionId: resolvedCorrectId,
  };
}

/**
 * Shuffles question ordering, updating display indexes while preserving question ids.
 */
export function shuffleQuestions(
  questions: readonly Question[],
  rng: () => number = Math.random,
): Question[] {
  const shuffled = shuffleArray(questions, rng);
  return shuffled.map((q, index) => ({
    ...q,
    index: index + 1,
  }));
}

/**
 * Fully shuffles an exam: randomizes question order and the options within each question,
 * preserving all answer correctness mappings.
 */
export function shuffleExercise(
  questions: readonly Question[],
  options?: {
    shuffleQuestionsOrder?: boolean;
    shuffleOptionsOrder?: boolean;
    rng?: () => number;
  },
): Question[] {
  const shuffleQ = options?.shuffleQuestionsOrder !== false;
  const shuffleOpt = options?.shuffleOptionsOrder !== false;
  const rng = options?.rng ?? Math.random;

  let result = questions.map((q) => (shuffleOpt ? shuffleQuestionOptions(q, rng) : { ...q }));
  if (shuffleQ) {
    result = shuffleQuestions(result, rng);
  }
  return result;
}
