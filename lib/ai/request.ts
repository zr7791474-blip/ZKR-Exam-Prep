import { z } from 'zod';
import type { Question, QuestionOption, QuestionType } from '../models/exam';
import { questionInputSchema } from './schemas';

export type QuestionInput = z.infer<typeof questionInputSchema>;

function normaliseOptions(input: QuestionInput): QuestionOption[] {
  return input.options.map((option) => ({
    id: option.id,
    label: option.label.toUpperCase(),
    text: option.text,
    ...(option.isCorrect !== undefined ? { isCorrect: option.isCorrect } : {}),
  }));
}

function inferQuestionType(input: QuestionInput): QuestionType {
  if (input.questionType) return input.questionType;
  if (input.options.length === 0) return 'free_response';
  if (input.options.length === 2) {
    const texts = input.options.map((o) => o.text.trim().toLowerCase());
    if (texts.every((t) => t === 'true' || t === 'false')) return 'true_false';
  }
  return input.correctOptionIds && input.correctOptionIds.length > 1
    ? 'multiple_choice'
    : 'single_choice';
}

/**
 * Rebuilds a full `Question` from validated client input. Server-owned fields
 * (AI solutions, disputes) are never accepted from the client, so a caller
 * cannot inject a fake "verified" status or explanation.
 */
export function toQuestion(input: QuestionInput): Question {
  const options = normaliseOptions(input);
  const correctIds =
    input.correctOptionIds?.filter(Boolean) ??
    (input.correctOptionId ? [input.correctOptionId] : []);
  const hasKnownAnswer =
    input.hasKnownAnswer ??
    (correctIds.length > 0 || (input.acceptedAnswers?.length ?? 0) > 0);

  return {
    id: input.id,
    index: input.index,
    prompt: input.prompt,
    options,
    correctOptionId: input.correctOptionId ?? correctIds[0] ?? null,
    ...(correctIds.length > 1 ? { correctOptionIds: correctIds } : {}),
    hasKnownAnswer,
    confidence: input.confidence ?? 'medium',
    ...(input.explanation ? { explanation: input.explanation } : {}),
    questionType: inferQuestionType(input),
    ...(input.acceptedAnswers ? { acceptedAnswers: input.acceptedAnswers } : {}),
    ...(input.pageNumber ? { pageNumber: input.pageNumber } : {}),
    ...(input.sourceReference ? { sourceReference: input.sourceReference } : {}),
    // Status and verification level are derived on the server. A client can
    // never claim that an answer is AI-verified or officially confirmed.
    answerStatus: hasKnownAnswer ? 'official_answer' : 'unanswered',
    verificationLevel: 1,
    ...(input.officialAnswerLabel ? { officialAnswerLabel: input.officialAnswerLabel } : {}),
    officialCorrectOptionId:
      input.officialCorrectOptionId ?? (hasKnownAnswer ? input.correctOptionId ?? correctIds[0] ?? null : null),
    ...(input.subjectTopic ? { subjectTopic: input.subjectTopic } : {}),
    ...(input.hasDiagram !== undefined ? { hasDiagram: input.hasDiagram } : {}),
    ...(input.isAiGenerated !== undefined ? { isAiGenerated: input.isAiGenerated } : {}),
    ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
    ...(input.missingInformation ? { missingInformation: input.missingInformation } : {}),
  };
}
