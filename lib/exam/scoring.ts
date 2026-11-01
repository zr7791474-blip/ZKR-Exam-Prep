import type { AnswerValue, Question, ScoreSummary } from '../models/exam';

function selectedIds(value: AnswerValue | undefined): string[] {
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean))];
  if (typeof value === 'string' && value) return [value];
  return [];
}

function normaliseFreeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Only answers backed by a reliable key are included in the objective score. */
export function isReliableAnswer(question: Question): boolean {
  if (!question.hasKnownAnswer) return false;
  const status = question.answerStatus;
  if (!status) {
    // Legacy questions without a status are trusted only when a key exists.
    return question.correctOptionId !== null || (question.acceptedAnswers?.length ?? 0) > 0;
  }
  return (
    status === 'official_answer' ||
    status === 'user_confirmed' ||
    status === 'ai_verified'
  );
}

function isFreeResponse(question: Question): boolean {
  return question.questionType === 'free_response' || question.options.length === 0;
}

function correctIdsFor(question: Question): string[] {
  if (question.correctOptionIds?.length) return question.correctOptionIds;
  if (question.correctOptionId) return [question.correctOptionId];
  return [];
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * Evaluates user answers against questions.
 * Reliable scores use only official, user-confirmed, or independently verified
 * keys. AI proposals and disputed keys are reported separately and never
 * silently treated as ground truth.
 */
export function scoreAttempt(
  questions: readonly Question[],
  answers: Record<string, AnswerValue>,
  freeTextAnswers: Record<string, string> = {},
): ScoreSummary {
  let knownAnswerQuestions = 0;
  let unknownAnswerQuestions = 0;
  let answeredCount = 0;
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let aiProposedQuestions = 0;
  let disputedQuestions = 0;
  let needsReviewQuestions = 0;
  let freeResponseQuestions = 0;
  const mistakes: ScoreSummary['mistakes'] = [];

  for (const q of questions) {
    const freeText = freeTextAnswers[q.id]?.trim() ?? '';
    const selected = selectedIds(answers[q.id]);
    const isAnswered = isFreeResponse(q) ? freeText.length > 0 : selected.length > 0;

    if (isAnswered) answeredCount++;
    else unansweredCount++;

    if (isFreeResponse(q)) freeResponseQuestions++;
    if (q.answerStatus === 'ai_proposed') aiProposedQuestions++;
    if (q.answerStatus === 'disputed') disputedQuestions++;
    if (q.answerStatus === 'needs_review') needsReviewQuestions++;

    const reliable = isReliableAnswer(q);

    if (!reliable) {
      unknownAnswerQuestions++;
      continue;
    }

    knownAnswerQuestions++;
    let isCorrect = false;

    if (isFreeResponse(q)) {
      const accepted = (q.acceptedAnswers ?? []).map(normaliseFreeText).filter(Boolean);
      const actual = normaliseFreeText(freeText);
      isCorrect = actual.length > 0 && accepted.some((value) => value === actual);
    } else {
      const correctIds = correctIdsFor(q);
      isCorrect = setsEqual(selected, correctIds);
    }

    if (isCorrect) {
      correctCount++;
    } else {
      incorrectCount++;
      mistakes.push({
        question: q,
        selectedOptionId: selected[0] ?? null,
        selectedOptionIds: selected,
        correctOptionId: q.correctOptionId,
        correctOptionIds: correctIdsFor(q),
        isUnanswered: !isAnswered,
      });
    }
  }

  const scorePercentage =
    knownAnswerQuestions > 0 ? Math.round((correctCount / knownAnswerQuestions) * 100) : null;

  return {
    totalQuestions: questions.length,
    knownAnswerQuestions,
    unknownAnswerQuestions,
    answeredCount,
    correctCount,
    incorrectCount,
    unansweredCount,
    scorePercentage,
    reliableKnownAnswerQuestions: knownAnswerQuestions,
    aiProposedQuestions,
    disputedQuestions,
    needsReviewQuestions,
    freeResponseQuestions,
    mistakes,
  };
}

/**
 * Produces a clear, human-readable summary of the attempt score.
 */
export function formatScoreSummary(summary: ScoreSummary): string {
  if (summary.knownAnswerQuestions === 0) {
    const ai =
      summary.aiProposedQuestions && summary.aiProposedQuestions > 0
        ? ` — ${summary.aiProposedQuestions} AI-proposed`
        : '';
    return `${summary.answeredCount}/${summary.totalQuestions} answered (no verified answer key)${ai}`;
  }

  const base = `${summary.correctCount}/${summary.knownAnswerQuestions} (${summary.scorePercentage}%)`;
  const extras: string[] = [];
  if (summary.unknownAnswerQuestions > 0) extras.push(`${summary.unknownAnswerQuestions} unkeyed`);
  if (summary.aiProposedQuestions && summary.aiProposedQuestions > 0) {
    extras.push(`${summary.aiProposedQuestions} AI-proposed (excluded)`);
  }
  if (summary.disputedQuestions && summary.disputedQuestions > 0) {
    extras.push(`${summary.disputedQuestions} disputed (excluded)`);
  }
  return extras.length > 0 ? `${base} — ${extras.join(', ')}` : base;
}
