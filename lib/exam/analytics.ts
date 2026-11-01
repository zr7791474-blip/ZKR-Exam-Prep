import type { AnswerValue, ExamAttempt, Question, WeakTopic } from '../models/exam';
import { isReliableAnswer, scoreAttempt } from './scoring';

function selectedIds(value: AnswerValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export function computeWeakTopics(
  questions: readonly Question[],
  answers: Record<string, AnswerValue>,
  freeTextAnswers: Record<string, string> = {},
): WeakTopic[] {
  const map = new Map<string, { correct: number; total: number }>();

  for (const question of questions) {
    if (!isReliableAnswer(question)) continue;
    const topic = question.subjectTopic ?? 'General Assessment';
    const entry = map.get(topic) ?? { correct: 0, total: 0 };
    entry.total++;

    const freeText = freeTextAnswers[question.id]?.trim() ?? '';
    const selected = selectedIds(answers[question.id]);
    const correctIds = question.correctOptionIds?.length
      ? question.correctOptionIds
      : question.correctOptionId
        ? [question.correctOptionId]
        : [];

    let correct = false;
    if (question.questionType === 'free_response' || question.options.length === 0) {
      const actual = freeText.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      correct =
        actual.length > 0 &&
        (question.acceptedAnswers ?? [])
          .map((v) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
          .includes(actual);
    } else {
      correct =
        selected.length === correctIds.length &&
        [...selected].sort().every((id, idx) => id === [...correctIds].sort()[idx]);
    }

    if (correct) entry.correct++;
    map.set(topic, entry);
  }

  return [...map.entries()]
    .map(([topic, value]) => ({
      topic,
      incorrectCount: value.total - value.correct,
      totalCount: value.total,
      accuracy: value.total > 0 ? Math.round((value.correct / value.total) * 100) : 0,
    }))
    .filter((topic) => topic.incorrectCount > 0)
    .sort((a, b) => a.accuracy - b.accuracy || b.incorrectCount - a.incorrectCount);
}

export interface LearningReport {
  reliableScorePercentage: number | null;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  answeredCount: number;
  aiProposedCount: number;
  disputedCount: number;
  needsReviewCount: number;
  weakTopics: WeakTopic[];
  recommendedQuestionIds: string[];
  summary: string;
}

/**
 * Builds the post-exam learning report. The objective score is explicitly based
 * only on reliable keys; AI proposals and disputed keys are reported separately.
 */
export function buildLearningReport(attempt: ExamAttempt): LearningReport {
  const summary = scoreAttempt(
    attempt.questionsSnapshot,
    attempt.answers,
    attempt.freeTextAnswers ?? {},
  );
  const weakTopics =
    attempt.weakTopics ??
    computeWeakTopics(attempt.questionsSnapshot, attempt.answers, attempt.freeTextAnswers ?? {});

  const weakTopicNames = new Set(weakTopics.slice(0, 5).map((t) => t.topic));
  const recommendedQuestionIds: string[] = [];

  // Prioritise reliable mistakes in weak topics, then disputed/needs-review items.
  for (const mistake of summary.mistakes) {
    const topic = mistake.question.subjectTopic ?? 'General Assessment';
    if (weakTopicNames.has(topic) || weakTopics.length === 0) {
      recommendedQuestionIds.push(mistake.question.id);
    }
  }
  for (const question of attempt.questionsSnapshot) {
    if (
      question.answerStatus === 'disputed' ||
      question.answerStatus === 'needs_review' ||
      question.answerStatus === 'ai_proposed'
    ) {
      if (!recommendedQuestionIds.includes(question.id)) {
        recommendedQuestionIds.push(question.id);
      }
    }
  }

  const parts: string[] = [];
  if (summary.scorePercentage !== null) {
    parts.push(
      `Reliable score: ${summary.correctCount}/${summary.knownAnswerQuestions} (${summary.scorePercentage}%).`,
    );
  } else {
    parts.push('No reliable answer key was available, so no objective score is shown.');
  }
  if (summary.aiProposedQuestions) {
    parts.push(
      `${summary.aiProposedQuestions} AI-proposed question(s) were excluded from the score and need review.`,
    );
  }
  if (summary.disputedQuestions) {
    parts.push(`${summary.disputedQuestions} disputed answer key(s) were excluded from the score.`);
  }
  if (weakTopics.length > 0) {
    parts.push(
      `Topics to revise: ${weakTopics
        .slice(0, 3)
        .map((t) => `${t.topic} (${t.accuracy}%)`)
        .join(', ')}.`,
    );
  }

  return {
    reliableScorePercentage: summary.scorePercentage,
    correctCount: summary.correctCount,
    incorrectCount: summary.incorrectCount,
    unansweredCount: summary.unansweredCount,
    answeredCount: summary.answeredCount,
    aiProposedCount: summary.aiProposedQuestions ?? 0,
    disputedCount: summary.disputedQuestions ?? 0,
    needsReviewCount: summary.needsReviewQuestions ?? 0,
    weakTopics,
    recommendedQuestionIds: recommendedQuestionIds.slice(0, 20),
    summary: parts.join(' '),
  };
}

/** Aggregates recurring weaknesses across attempt history. */
export function aggregateWeakTopics(attempts: readonly ExamAttempt[]): WeakTopic[] {
  const map = new Map<string, { incorrect: number; total: number }>();
  for (const attempt of attempts) {
    for (const topic of attempt.weakTopics ?? []) {
      const entry = map.get(topic.topic) ?? { incorrect: 0, total: 0 };
      entry.incorrect += topic.incorrectCount;
      entry.total += topic.totalCount;
      map.set(topic.topic, entry);
    }
  }

  return [...map.entries()]
    .map(([topic, value]) => ({
      topic,
      incorrectCount: value.incorrect,
      totalCount: value.total,
      accuracy: value.total > 0 ? Math.round(((value.total - value.incorrect) / value.total) * 100) : 0,
    }))
    .filter((t) => t.incorrectCount > 0)
    .sort((a, b) => a.accuracy - b.accuracy || b.incorrectCount - a.incorrectCount);
}

/** Picks questions from the active exam that target the student's weak topics. */
export function recommendRevisionQuestions(
  questions: readonly Question[],
  weakTopics: readonly WeakTopic[],
  limit = 10,
): Question[] {
  const topics = new Set(weakTopics.map((t) => t.topic));
  const targeted = questions.filter((q) => topics.has(q.subjectTopic ?? 'General Assessment'));
  const fallback = questions.filter(
    (q) => q.answerStatus === 'disputed' || q.answerStatus === 'needs_review',
  );
  const merged = [...targeted, ...fallback, ...questions];
  const seen = new Set<string>();
  return merged
    .filter((q) => {
      if (seen.has(q.id)) return false;
      seen.add(q.id);
      return true;
    })
    .slice(0, limit);
}
