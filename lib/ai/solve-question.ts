import type { AIQuestionSolution, Question } from '../models/exam';
import { questionFingerprint } from '../exam/fingerprint';
import { cacheGet, cacheKey, cacheSet } from './cache';
import { AIProviderError, parseJsonObject, type ProviderClient } from './provider';
import { buildSolvePrompt } from './prompts';
import {
  labelsToOptionIds,
  validateSolutionForQuestion,
  type RawAISolution,
} from './schemas';
import { solutionLabels, verifyAnswer } from './verify-answer';

export interface SolveQuestionsOptions {
  provider?: ProviderClient | null;
  verifier?: ProviderClient | null;
  checkOfficialAnswers?: boolean;
  maxQuestions?: number;
  concurrency?: number;
  signal?: AbortSignal;
  useCache?: boolean;
  repairRetries?: number;
  now?: () => string;
}

export interface SolveQuestionsResult {
  questions: Question[];
  solvedCount: number;
  disputedCount: number;
  verifiedCount: number;
  warnings: string[];
  remainingCount: number;
}

function officialLabels(question: Question): string[] {
  if (question.officialAnswerLabels?.length) return question.officialAnswerLabels;
  if (question.officialAnswerLabel) {
    return question.officialAnswerLabel
      .split(/\s*,\s*/)
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean);
  }
  const ids = question.officialCorrectOptionIds?.length
    ? question.officialCorrectOptionIds
    : question.officialCorrectOptionId
      ? [question.officialCorrectOptionId]
      : [];
  return ids
    .map((id) => question.options.find((o) => o.id === id)?.label)
    .filter((label): label is string => Boolean(label));
}

function sameAnswerSet(a: string[], b: string[]): boolean {
  const left = [...a].map((v) => v.toUpperCase()).sort();
  const right = [...b].map((v) => v.toUpperCase()).sort();
  return left.length === right.length && left.every((value, idx) => value === right[idx]);
}

function disputeText(
  question: Question,
  official: string[],
  proposed: string[],
  solution: RawAISolution,
  verificationDetail: string,
  verificationAgreesWithOfficial: boolean,
): string {
  return [
    `Official source answer: ${official.join(', ') || 'unknown'}.`,
    `AI analysis: ${proposed.join(', ') || 'no valid answer'} (${solution.confidence} confidence).`,
    `AI reasoning: ${solution.explanation}`,
    `Verification: ${verificationDetail}`,
    verificationAgreesWithOfficial
      ? 'An independent verification pass supported the official answer, so the first AI answer is likely wrong.'
      : 'Review this disagreement manually.',
    'Possible causes: an incorrect source answer key, an extraction error, ambiguous wording, multiple valid answers, or outdated information.',
  ].join(' ');
}

function makeSolution(
  solution: RawAISolution,
  provider: ProviderClient,
  status: AIQuestionSolution['status'],
  verification: { level: 1 | 2 | 3; method: string },
  generatedAt: string,
): AIQuestionSolution {
  return {
    answer: solution.answers?.length ? solution.answers.join(', ') : solution.answer,
    answerText: solution.answerText ?? '',
    explanation: solution.explanation,
    optionAnalysis: solution.optionAnalysis ?? [],
    confidence: solution.confidence,
    status,
    verificationLevel: verification.level,
    questionType: solution.questionType,
    verificationMethod: verification.method,
    assumptions: solution.assumptions ?? [],
    missingInformation: solution.missingInformation ?? [],
    sources: solution.sources ?? [],
    provider: provider.name,
    model: provider.model,
    generatedAt,
  };
}

async function requestSolution(
  question: Question,
  options: SolveQuestionsOptions,
  provider: ProviderClient,
  repairRetries: number,
): Promise<{ solution: RawAISolution; labels: string[] }> {
  const { system, user } = buildSolvePrompt(question, {
    checkOfficialAnswers: options.checkOfficialAnswers,
  });
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  let lastErrors: string[] = [];
  for (let attempt = 0; attempt <= repairRetries; attempt++) {
    const raw = await provider.chat(messages, { json: true, signal: options.signal });
    const validation = validateSolutionForQuestion(parseJsonObject(raw), question);
    if (validation.ok && validation.solution) {
      return { solution: validation.solution, labels: solutionLabels(validation.solution, question) };
    }

    lastErrors = validation.errors;
    if (attempt < repairRetries) {
      messages.push(
        { role: 'assistant', content: raw.slice(0, 4000) },
        {
          role: 'user',
          content: `Your response was rejected: ${validation.errors.slice(0, 4).join('; ')}.
Return corrected JSON only. Use only the option labels that exist in the question and include a non-empty explanation.`,
        },
      );
    }
  }

  throw new AIProviderError(
    'INVALID_RESPONSE',
    `The AI answer failed validation: ${lastErrors.slice(0, 2).join('; ')}`,
  );
}

function applySolution(
  question: Question,
  solution: RawAISolution,
  labels: string[],
  verification: Awaited<ReturnType<typeof verifyAnswer>>,
  provider: ProviderClient,
  checkOfficialAnswers: boolean,
  generatedAt: string,
): Question {
  const proposedIds = labelsToOptionIds(labels, question.options);
  const official = officialLabels(question);
  const updated: Question = { ...question, options: question.options.map((o) => ({ ...o })) };

  if (question.hasKnownAnswer && official.length > 0) {
    const agrees = sameAnswerSet(official, labels);
    const verificationAgreesWithOfficial = sameAnswerSet(official, verification.independentLabels);

    if (agrees) {
      updated.answerStatus = 'official_answer';
      updated.verificationLevel = 1;
      updated.aiSolution = makeSolution(
        solution,
        provider,
        'ai_proposed',
        { level: 1, method: verification.method },
        generatedAt,
      );
      if (!updated.explanation) updated.explanation = solution.explanation;
      return updated;
    }

    updated.answerStatus = 'disputed';
    updated.verificationLevel = 1;
    updated.disputeExplanation = disputeText(
      question,
      official,
      labels,
      solution,
      verification.detail,
      verificationAgreesWithOfficial,
    );
    updated.aiSolution = makeSolution(
      solution,
      provider,
      'disputed',
      { level: verification.level, method: verification.method },
      generatedAt,
    );
    // Never overwrite the official answer.
    updated.correctOptionId = question.officialCorrectOptionId ?? question.correctOptionId;
    updated.correctOptionIds = question.officialCorrectOptionIds ?? question.correctOptionIds;
    updated.hasKnownAnswer = true;
    return updated;
  }

  const isFreeResponse =
    question.questionType === 'free_response' || question.options.length === 0;

  const solutionRecord = makeSolution(
    solution,
    provider,
    'ai_proposed',
    { level: verification.level, method: verification.method },
    generatedAt,
  );

  if (verification.disagrees) {
    updated.answerStatus = 'needs_review';
    updated.verificationLevel = verification.level;
    updated.aiSolution = {
      ...solutionRecord,
      status: 'needs_review',
      missingInformation: [
        ...(solutionRecord.missingInformation ?? []),
        verification.detail,
      ],
    };
    updated.missingInformation = [...(updated.missingInformation ?? []), verification.detail];
    updated.hasKnownAnswer = false;
    updated.correctOptionId = null;
    updated.correctOptionIds = undefined;
    return updated;
  }

  if (verification.verified && verification.level === 3) {
    updated.answerStatus = 'ai_verified';
    updated.verificationLevel = 3;
    updated.aiSolution = { ...solutionRecord, status: 'ai_verified' };
    updated.hasKnownAnswer = true;
    if (isFreeResponse) {
      updated.acceptedAnswers = [
        solution.answerText || solution.answer,
        ...(solution.answers ?? []),
      ].filter(Boolean);
    } else {
      updated.correctOptionId = proposedIds[0] ?? null;
      updated.correctOptionIds = proposedIds.length > 1 ? proposedIds : undefined;
      updated.options = updated.options.map((option) => ({
        ...option,
        isCorrect: proposedIds.includes(option.id),
      }));
    }
    if (!updated.explanation) updated.explanation = solution.explanation;
    return updated;
  }

  if (solution.confidence === 'low' || (solution.missingInformation?.length ?? 0) > 0) {
    updated.answerStatus = 'needs_review';
    updated.verificationLevel = verification.level;
    updated.aiSolution = { ...solutionRecord, status: 'needs_review' };
    updated.hasKnownAnswer = false;
    updated.correctOptionId = null;
    updated.correctOptionIds = undefined;
    updated.missingInformation = solution.missingInformation;
    return updated;
  }

  updated.answerStatus = 'ai_proposed';
  updated.verificationLevel = 2;
  updated.aiSolution = solutionRecord;
  updated.hasKnownAnswer = false;
  updated.correctOptionId = null;
  updated.correctOptionIds = undefined;
  if (!updated.explanation) updated.explanation = solution.explanation;
  return updated;
}

/**
 * Solves questions in bounded batches with caching and bounded concurrency.
 * Official answers are never overwritten; disagreements become `disputed`.
 */
export async function solveQuestions(
  questions: readonly Question[],
  options: SolveQuestionsOptions = {},
): Promise<SolveQuestionsResult> {
  const provider = options.provider ?? null;
  if (!provider) {
    throw new AIProviderError(
      'MISSING_KEY',
      'AI is not configured on this server. Add AI_PROVIDER and an API key to enable solving.',
    );
  }
  const activeProvider: ProviderClient = provider;

  const maxQuestions = Math.max(1, options.maxQuestions ?? 30);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));
  const repairRetries = Math.max(0, Math.min(options.repairRetries ?? 1, 2));
  const useCache = options.useCache ?? true;
  const now = options.now ?? (() => new Date().toISOString());

  const candidates = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      if (question.hasDiagram) return false;
      if (question.hasKnownAnswer) return Boolean(options.checkOfficialAnswers);
      return true;
    })
    .sort((a, b) => Number(a.question.hasKnownAnswer) - Number(b.question.hasKnownAnswer))
    .slice(0, maxQuestions);

  const skippedForLimit = questions.filter(
    (q) => !q.hasKnownAnswer && !q.hasDiagram,
  ).length - candidates.filter((c) => !c.question.hasKnownAnswer).length;

  const warnings: string[] = [];
  const diagramCount = questions.filter((q) => q.hasDiagram).length;
  if (diagramCount > 0) {
    warnings.push(
      `${diagramCount} question(s) reference a diagram and were left for manual review instead of guessing.`,
    );
  }
  if (skippedForLimit > 0) {
    warnings.push(
      `${skippedForLimit} unanswered question(s) were not processed in this batch. Run AI solving again to continue.`,
    );
  }

  const byId = new Map<string, Question>();
  const fingerprintCache = new Map<string, { solution: RawAISolution; labels: string[] }>();
  let solvedCount = 0;
  let disputedCount = 0;
  let verifiedCount = 0;
  let cursor = 0;

  async function processOne(question: Question): Promise<void> {
    const fingerprint = question.fingerprint ?? questionFingerprint(question);
    const key = cacheKey([
      'solve-v1',
      activeProvider.name,
      activeProvider.model,
      fingerprint,
      options.checkOfficialAnswers ? 'official' : 'unanswered',
    ]);

    let cached = useCache ? cacheGet<{ solution: RawAISolution; labels: string[] }>(key) : null;
    if (!cached) cached = fingerprintCache.get(key) ?? null;

    let solution: RawAISolution;
    let labels: string[];

    try {
      if (cached) {
        solution = cached.solution;
        labels = cached.labels;
      } else {
        const result = await requestSolution(question, options, activeProvider, repairRetries);
        solution = result.solution;
        labels = result.labels;
        if (useCache) cacheSet(key, { solution, labels });
        fingerprintCache.set(key, { solution, labels });
      }
    } catch (err) {
      if (err instanceof AIProviderError && (err.code === 'MISSING_KEY' || err.code === 'INVALID_KEY')) {
        throw err;
      }
      warnings.push(
        `Question ${question.index}: ${
          err instanceof AIProviderError ? err.message : 'AI solving failed.'
        }`,
      );
      return;
    }

    const verification = await verifyAnswer(question, labels, {
      verifier: options.verifier ?? null,
      primary: activeProvider,
      signal: options.signal,
    });

    const updated = applySolution(
      question,
      solution,
      labels,
      verification,
      activeProvider,
      Boolean(options.checkOfficialAnswers),
      now(),
    );

    byId.set(question.id, updated);
    solvedCount++;
    if (updated.answerStatus === 'disputed') disputedCount++;
    if (updated.answerStatus === 'ai_verified') verifiedCount++;
  }

  const workers = Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const current = candidates[cursor++];
      await processOne(current.question);
    }
  });

  await Promise.all(workers);

  const updatedQuestions = questions.map((question) => byId.get(question.id) ?? question);
  const remainingCount = questions.filter(
    (q) => !q.hasKnownAnswer && !q.hasDiagram && !byId.has(q.id),
  ).length;

  return {
    questions: updatedQuestions,
    solvedCount,
    disputedCount,
    verifiedCount,
    warnings: warnings.slice(0, 20),
    remainingCount,
  };
}
