import type { Question, QuestionOption } from '../models/exam';
import { questionFingerprint } from '../exam/fingerprint';
import { parseJsonObject, AIProviderError, type ProviderClient } from './provider';
import {
  buildChallengePrompt,
  buildExplainPrompt,
  buildSimilarPrompt,
} from './prompts';
import {
  challengeResponseSchema,
  explanationResponseSchema,
  similarQuestionsSchema,
  validateSolutionForQuestion,
} from './schemas';
import { solutionLabels } from './verify-answer';

export interface ExplanationResult {
  explanation: string;
  keyPoints: string[];
  commonMistake: string;
  confidence: 'high' | 'medium' | 'low';
  provider: string;
  model: string;
}

export async function explainQuestion(
  question: Question,
  mode: 'simpler' | 'steps' | 'example',
  provider: ProviderClient,
  signal?: AbortSignal,
): Promise<ExplanationResult> {
  const { system, user } = buildExplainPrompt(question, mode);
  const raw = await provider.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, signal },
  );
  const parsed = explanationResponseSchema.safeParse(parseJsonObject(raw));
  if (!parsed.success) {
    throw new AIProviderError('INVALID_RESPONSE', 'The AI explanation was malformed.');
  }
  return {
    ...parsed.data,
    provider: provider.name,
    model: provider.model,
  };
}

export interface ChallengeResult {
  solution: ReturnType<typeof challengeResponseSchema.parse>;
  labels: string[];
  changed: boolean;
  provider: string;
  model: string;
}

export async function challengeAnswer(
  question: Question,
  currentAnswerLabel: string | undefined,
  provider: ProviderClient,
  signal?: AbortSignal,
): Promise<ChallengeResult> {
  const { system, user } = buildChallengePrompt(question, currentAnswerLabel);
  const raw = await provider.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, signal },
  );
  const rawObject = parseJsonObject(raw);
  const validation = validateSolutionForQuestion(rawObject, question);
  if (!validation.ok || !validation.solution) {
    throw new AIProviderError(
      'INVALID_RESPONSE',
      `The AI response was rejected: ${validation.errors.slice(0, 2).join('; ')}`,
    );
  }
  const parsed = challengeResponseSchema.safeParse({
    ...validation.solution,
    changed: (rawObject as { changed?: boolean }).changed,
  });
  if (!parsed.success) {
    throw new AIProviderError('INVALID_RESPONSE', 'The AI challenge response was malformed.');
  }

  const labels = solutionLabels(validation.solution, question);
  const previous = (currentAnswerLabel ?? '').toUpperCase();
  return {
    solution: parsed.data,
    labels,
    changed: parsed.data.changed ?? (previous !== '' && !labels.includes(previous)),
    provider: provider.name,
    model: provider.model,
  };
}

export interface SimilarQuestionsResult {
  questions: Question[];
  provider: string;
  model: string;
}

function makeOption(index: number, text: string): QuestionOption {
  return {
    id: `ai-opt-${index + 1}`,
    label: String.fromCharCode(65 + index),
    text,
    isCorrect: false,
  };
}

/**
 * Generates new practice questions. They are always marked `isAiGenerated` and
 * `generation: 'ai'` so they can never be mistaken for source exam questions.
 */
export async function generateSimilarQuestions(
  question: Question,
  count: number,
  provider: ProviderClient,
  signal?: AbortSignal,
): Promise<SimilarQuestionsResult> {
  const { system, user } = buildSimilarPrompt(question, count);
  const raw = await provider.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, signal },
  );
  const parsed = similarQuestionsSchema.safeParse(parseJsonObject(raw));
  if (!parsed.success) {
    throw new AIProviderError('INVALID_RESPONSE', 'The generated questions were malformed.');
  }

  const seen = new Set<string>();
  const generated: Question[] = [];
  const now = Date.now();

  for (const item of parsed.data.questions.slice(0, count)) {
    const normalised = item.prompt.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalised || seen.has(normalised)) continue;
    seen.add(normalised);

    const labels = item.options.map((o) => o.label.toUpperCase());
    if (new Set(labels).size !== labels.length) continue;
    const correctLabel = item.correctLabel.trim().toUpperCase();
    if (!labels.includes(correctLabel)) continue;

    const options: QuestionOption[] = item.options.map((option, index) => ({
      ...makeOption(index, option.text),
      label: option.label.toUpperCase(),
      id: `ai-${now}-${generated.length}-opt-${index + 1}`,
      isCorrect: option.label.toUpperCase() === correctLabel,
    }));

    const correctOption = options.find((o) => o.isCorrect);
    if (!correctOption) continue;

    generated.push({
      id: `ai-${now}-${generated.length}`,
      index: generated.length + 1,
      prompt: item.prompt,
      options,
      correctOptionId: correctOption.id,
      hasKnownAnswer: true,
      confidence: 'medium',
      explanation: item.explanation,
      questionType: options.length === 2 ? 'true_false' : 'single_choice',
      answerStatus: 'ai_proposed',
      verificationLevel: 2,
      subjectTopic: question.subjectTopic ?? 'General Assessment',
      isAiGenerated: true,
      generation: 'ai',
      fingerprint: questionFingerprint({ prompt: item.prompt, options }),
      missingInformation: [],
    });
  }

  if (generated.length === 0) {
    throw new AIProviderError('INVALID_RESPONSE', 'No valid generated questions passed validation.');
  }

  return { questions: generated, provider: provider.name, model: provider.model };
}
