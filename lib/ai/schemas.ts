import { z } from 'zod';
import type { Question } from '../models/exam';

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export const questionTypeSchema = z.enum([
  'single_choice',
  'multiple_choice',
  'true_false',
  'free_response',
]);

export const optionAnalysisSchema = z.object({
  option: z.string().min(1).max(24),
  isCorrect: z.boolean(),
  reason: z.string().min(1).max(2000),
});

/**
 * Strict schema for model output. Unknown fields are stripped so malformed
 * provider output can never corrupt saved exam data.
 */
export const aiSolutionSchema = z.object({
  answer: z.string().min(1).max(500),
  answers: z.array(z.string().min(1).max(120)).max(8).optional(),
  answerText: z.string().max(2000).optional().default(''),
  explanation: z.string().min(1).max(8000),
  optionAnalysis: z.array(optionAnalysisSchema).max(12).optional().default([]),
  confidence: confidenceSchema,
  questionType: questionTypeSchema.optional(),
  missingInformation: z.array(z.string().max(1000)).max(10).optional().default([]),
  assumptions: z.array(z.string().max(1000)).max(10).optional().default([]),
  sources: z.array(z.string().max(500)).max(10).optional().default([]),
  verificationMethod: z.string().max(500).optional(),
});

export type RawAISolution = z.infer<typeof aiSolutionSchema>;

export const questionOptionInputSchema = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(12),
  text: z.string().max(4000),
  isCorrect: z.boolean().optional(),
});

export const questionInputSchema = z.object({
  id: z.string().min(1).max(200),
  index: z.number().int().nonnegative(),
  prompt: z.string().min(1).max(12000),
  options: z.array(questionOptionInputSchema).max(12),
  correctOptionId: z.string().max(200).nullable().optional(),
  correctOptionIds: z.array(z.string().max(200)).max(12).optional(),
  hasKnownAnswer: z.boolean().optional(),
  confidence: confidenceSchema.optional(),
  explanation: z.string().max(8000).optional(),
  questionType: questionTypeSchema.optional(),
  acceptedAnswers: z.array(z.string().max(500)).max(20).optional(),
  pageNumber: z.number().int().positive().optional(),
  sourceReference: z.string().max(300).optional(),
  answerStatus: z
    .enum([
      'official_answer',
      'ai_proposed',
      'ai_verified',
      'user_confirmed',
      'disputed',
      'unanswered',
      'needs_review',
    ])
    .optional(),
  verificationLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  officialAnswerLabel: z.string().max(200).optional(),
  officialCorrectOptionId: z.string().max(200).nullable().optional(),
  subjectTopic: z.string().max(120).optional(),
  hasDiagram: z.boolean().optional(),
  isAiGenerated: z.boolean().optional(),
  fingerprint: z.string().max(100).optional(),
  missingInformation: z.array(z.string().max(1000)).max(10).optional(),
});

export const solveRequestSchema = z.object({
  questions: z.array(questionInputSchema).min(1).max(60),
  checkOfficialAnswers: z.boolean().optional().default(false),
  maxQuestions: z.number().int().min(1).max(60).optional().default(30),
});

export const explainRequestSchema = z.object({
  question: questionInputSchema,
  mode: z.enum(['simpler', 'steps', 'example']).default('simpler'),
});

export const challengeRequestSchema = z.object({
  question: questionInputSchema,
  currentAnswerLabel: z.string().max(200).optional(),
});

export const similarRequestSchema = z.object({
  question: questionInputSchema,
  count: z.number().int().min(1).max(5).default(3),
});

export const similarQuestionSchema = z.object({
  prompt: z.string().min(1).max(4000),
  options: z
    .array(
      z.object({
        label: z.string().min(1).max(8),
        text: z.string().min(1).max(2000),
      }),
    )
    .min(2)
    .max(6),
  correctLabel: z.string().min(1).max(24),
  explanation: z.string().min(1).max(4000),
});

export const similarQuestionsSchema = z.object({
  questions: z.array(similarQuestionSchema).min(1).max(5),
});

export const explanationResponseSchema = z.object({
  explanation: z.string().min(1).max(8000),
  keyPoints: z.array(z.string().max(500)).max(8).optional().default([]),
  commonMistake: z.string().max(2000).optional().default(''),
  confidence: confidenceSchema.optional().default('medium'),
});

export const challengeResponseSchema = aiSolutionSchema.extend({
  changed: z.boolean().optional(),
});

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface SolutionValidation {
  ok: boolean;
  solution?: RawAISolution;
  errors: string[];
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Validates a model response against the original question. Rejects unsupported
 * option labels, answers that do not correspond to the question, and missing
 * explanations. Model-supplied status/verification fields are never trusted.
 */
export function validateSolutionForQuestion(
  raw: unknown,
  question: Pick<
    Question,
    'prompt' | 'options' | 'questionType' | 'acceptedAnswers' | 'hasKnownAnswer' | 'correctOptionId'
  >,
): SolutionValidation {
  const parsed = aiSolutionSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    };
  }

  const solution = parsed.data;
  const errors: string[] = [];
  const type =
    question.questionType ??
    (question.options.length === 0
      ? 'free_response'
      : question.options.length === 2
        ? 'single_choice'
        : 'single_choice');

  if (type === 'free_response' || question.options.length === 0) {
    if (!solution.answer.trim() && !solution.answerText?.trim()) {
      errors.push('Free-response answers must contain answer text.');
    }
    return { ok: errors.length === 0, solution, errors };
  }

  const optionLabels = question.options.map((o) => o.label.toUpperCase());
  const rawAnswers = solution.answers?.length ? solution.answers : [solution.answer];
  const labels: string[] = [];

  for (const value of rawAnswers) {
    const upper = value.trim().toUpperCase();
    if (/^[A-J]$/.test(upper)) {
      if (!optionLabels.includes(upper)) {
        errors.push(`Answer label ${upper} does not exist in this question.`);
      } else {
        labels.push(upper);
      }
      continue;
    }

    if (/^\d{1,2}$/.test(upper)) {
      const idx = parseInt(upper, 10) - 1;
      if (idx < 0 || idx >= question.options.length) {
        errors.push(`Answer index ${upper} is out of range.`);
      } else {
        labels.push(question.options[idx].label.toUpperCase());
      }
      continue;
    }

    const byText = question.options.find((o) => normalise(o.text) === normalise(value));
    if (byText) {
      labels.push(byText.label.toUpperCase());
      continue;
    }

    // Some models answer "True"/"False" for true/false questions.
    const bool = /^(true|false|yes|no|vrai|faux)$/i.test(value.trim())
      ? question.options.find((o) =>
          /^(true|false|yes|no|vrai|faux)$/i.test(o.text.trim())
            ? o.text.trim().toLowerCase().startsWith(value.trim().toLowerCase().slice(0, 1))
            : false,
        )
      : undefined;
    if (bool) {
      labels.push(bool.label.toUpperCase());
      continue;
    }

    errors.push(`Answer "${value.slice(0, 40)}" does not match any option.`);
  }

  const unique = [...new Set(labels)];
  if (unique.length === 0) errors.push('No valid answer label was returned.');
  if (type === 'single_choice' && unique.length > 1) {
    errors.push('A single-choice question must have exactly one answer.');
  }
  if (type === 'multiple_choice' && unique.length < 1) {
    errors.push('A multiple-answer question must have at least one answer.');
  }

  const allowedAnalysis = new Set(optionLabels);
  for (const item of solution.optionAnalysis ?? []) {
    const label = item.option.trim().toUpperCase();
    if (!allowedAnalysis.has(label)) {
      errors.push(`Option analysis references unsupported label ${item.option}.`);
    }
  }

  if (solution.answerText?.trim()) {
    const expected = question.options
      .filter((o) => unique.includes(o.label.toUpperCase()))
      .map((o) => normalise(o.text));
    const actual = normalise(solution.answerText);
    if (expected.length > 0 && !expected.some((e) => e === actual || e.includes(actual) || actual.includes(e))) {
      errors.push('answerText does not match the selected option text.');
    }
  }

  return { ok: errors.length === 0, solution, errors };
}

export function labelsToOptionIds(
  labels: string[],
  options: { id: string; label: string }[],
): string[] {
  return labels
    .map((label) => options.find((o) => o.label.toUpperCase() === label.toUpperCase())?.id)
    .filter((id): id is string => Boolean(id));
}
