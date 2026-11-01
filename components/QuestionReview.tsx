'use client';

import { useMemo, useState } from 'react';
import type {
  AICapabilityStatus,
  AnswerStatus,
  DocumentProcessingReport,
  Question,
  QuestionOption,
  QuestionType,
} from '../lib/models/exam';
import { ProcessingReport } from './ProcessingReport';
import {
  IconCheck,
  IconAlertTriangle,
  IconSparkles,
  IconSearch,
  IconPlus,
  IconTrash,
  IconRotateCw,
} from './ui/icons';
import { useToast } from './ui/Toast';

interface QuestionReviewProps {
  initialQuestions: Question[];
  examTitle: string;
  onStartExam: (questions: Question[]) => void;
  onStartPractice: (questions: Question[]) => void;
  onStartShuffle: (questions: Question[]) => void;
  onCancel: () => void;
  aiStatus?: AICapabilityStatus | null;
  processingReport?: DocumentProcessingReport;
}

type Filter = 'all' | AnswerStatus | 'low_confidence' | 'free_response';

interface ExplanationState {
  explanation: string;
  keyPoints: string[];
  commonMistake: string;
  confidence: string;
}

const LETTERS = 'ABCDEFGHIJ';

function letterAt(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

function statusMeta(status: AnswerStatus): { label: string; className: string } {
  switch (status) {
    case 'official_answer':
      return { label: 'Official Answer (L1)', className: 'ok' };
    case 'user_confirmed':
      return { label: 'Confirmed by You (L4)', className: 'ok' };
    case 'ai_verified':
      return { label: 'AI Verified (L3)', className: 'ok' };
    case 'ai_proposed':
      return { label: 'AI Proposed (Unverified)', className: 'warn' };
    case 'disputed':
      return { label: 'Disputed Key', className: 'err' };
    case 'needs_review':
      return { label: 'Needs Review', className: 'warn' };
    default:
      return { label: 'Unanswered / Unkeyed', className: '' };
  }
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

function optionIdsForLabels(question: Question, labels: string[]): string[] {
  return labels
    .map((label) => question.options.find((o) => o.label.toUpperCase() === label.toUpperCase())?.id)
    .filter((id): id is string => Boolean(id));
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!res.ok) {
    throw new Error(data?.error?.message ?? 'The AI request failed.');
  }
  return data as T;
}

export function QuestionReview({
  initialQuestions,
  examTitle,
  onStartExam,
  onStartPractice,
  onStartShuffle,
  onCancel,
  aiStatus,
  processingReport,
}: QuestionReviewProps) {
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [filter, setFilter] = useState<Filter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [explanations, setExplanations] = useState<Record<string, ExplanationState>>({});
  const [challenges, setChallenges] = useState<Record<string, string>>({});
  const { success, error, info } = useToast();

  const aiEnabled = aiStatus ? aiStatus.configured : true;

  function updateQuestion(qId: string, updater: (prev: Question) => Question) {
    setQuestions((list) => list.map((q) => (q.id === qId ? updater(q) : q)));
  }

  function reindex(list: Question[]): Question[] {
    return list.map((q, index) => ({ ...q, index: index + 1 }));
  }

  function handlePromptChange(qId: string, prompt: string) {
    updateQuestion(qId, (q) => ({ ...q, prompt }));
  }

  function handleTopicChange(qId: string, subjectTopic: string) {
    updateQuestion(qId, (q) => ({ ...q, subjectTopic }));
  }

  function handleOptionTextChange(qId: string, optId: string, text: string) {
    updateQuestion(qId, (q) => ({
      ...q,
      options: q.options.map((o) => (o.id === optId ? { ...o, text } : o)),
    }));
  }

  function handleSetCorrectOption(qId: string, optId: string) {
    updateQuestion(qId, (q) => {
      const isMulti = q.questionType === 'multiple_choice';
      const current = q.correctOptionIds?.length
        ? q.correctOptionIds
        : q.correctOptionId
          ? [q.correctOptionId]
          : [];
      const nextIds = isMulti
        ? current.includes(optId)
          ? current.filter((id) => id !== optId)
          : [...current, optId]
        : [optId];

      const officialIds =
        q.officialCorrectOptionIds?.length
          ? q.officialCorrectOptionIds
          : q.officialCorrectOptionId
            ? [q.officialCorrectOptionId]
            : [];
      const changedFromOfficial =
        officialIds.length > 0 && nextIds.length > 0 && !sameSet(officialIds, nextIds);

      return {
        ...q,
        options: q.options.map((o) => ({ ...o, isCorrect: nextIds.includes(o.id) })),
        correctOptionId: nextIds[0] ?? null,
        ...(nextIds.length > 1 ? { correctOptionIds: nextIds } : { correctOptionIds: undefined }),
        hasKnownAnswer: nextIds.length > 0,
        answerStatus: changedFromOfficial ? 'disputed' : 'user_confirmed',
        verificationLevel: changedFromOfficial ? q.verificationLevel : 4,
        ...(changedFromOfficial
          ? {
              disputeExplanation: `You changed the official answer (${officialIds
                .map((id) => q.options.find((o) => o.id === id)?.label ?? id)
                .join(', ')}) to ${nextIds
                .map((id) => q.options.find((o) => o.id === id)?.label ?? id)
                .join(', ')}. Confirm the answer to accept this change.`,
            }
          : { userConfirmedAt: new Date().toISOString() }),
      };
    });
  }

  function handleClearAnswer(qId: string) {
    updateQuestion(qId, (q) => ({
      ...q,
      options: q.options.map((o) => ({ ...o, isCorrect: undefined })),
      correctOptionId: null,
      correctOptionIds: undefined,
      hasKnownAnswer: false,
      answerStatus: 'unanswered',
      verificationLevel: 1,
      userConfirmedAt: undefined,
    }));
    info('Answer cleared');
  }

  function handleConfirm(qId: string) {
    updateQuestion(qId, (q) => {
      if (!q.hasKnownAnswer && (q.acceptedAnswers?.length ?? 0) === 0) return q;
      return {
        ...q,
        answerStatus: 'user_confirmed',
        verificationLevel: 4,
        userConfirmedAt: new Date().toISOString(),
        disputeExplanation: undefined,
      };
    });
    success('Answer confirmed (Level 4 Verification)');
  }

  function handleRestoreOfficial(qId: string) {
    updateQuestion(qId, (q) => {
      const officialIds =
        q.officialCorrectOptionIds?.length
          ? q.officialCorrectOptionIds
          : q.officialCorrectOptionId
            ? [q.officialCorrectOptionId]
            : [];
      if (officialIds.length === 0) return q;
      return {
        ...q,
        options: q.options.map((o) => ({ ...o, isCorrect: officialIds.includes(o.id) })),
        correctOptionId: officialIds[0] ?? null,
        ...(officialIds.length > 1 ? { correctOptionIds: officialIds } : { correctOptionIds: undefined }),
        hasKnownAnswer: true,
        answerStatus: 'official_answer',
        verificationLevel: 1,
        disputeExplanation: undefined,
        userConfirmedAt: undefined,
      };
    });
    success('Official answer restored (Level 1 Verification)');
  }

  function handleAcceptAi(qId: string) {
    updateQuestion(qId, (q) => {
      const labels = q.aiSolution?.answer
        ? q.aiSolution.answer.split(/\s*,\s*/).map((v) => v.trim().toUpperCase())
        : [];
      const ids = optionIdsForLabels(q, labels);
      if (ids.length === 0) return q;
      return {
        ...q,
        options: q.options.map((o) => ({ ...o, isCorrect: ids.includes(o.id) })),
        correctOptionId: ids[0] ?? null,
        ...(ids.length > 1 ? { correctOptionIds: ids } : { correctOptionIds: undefined }),
        hasKnownAnswer: true,
        answerStatus: 'user_confirmed',
        verificationLevel: 4,
        userConfirmedAt: new Date().toISOString(),
        disputeExplanation: q.disputeExplanation,
      };
    });
    success('Accepted AI answer and confirmed by you');
  }

  function handleQuestionTypeChange(qId: string, type: QuestionType) {
    updateQuestion(qId, (q) => {
      const ids =
        q.correctOptionIds?.length
          ? q.correctOptionIds
          : q.correctOptionId
            ? [q.correctOptionId]
            : [];
      const nextIds = type === 'multiple_choice' ? ids : ids.slice(0, 1);
      return {
        ...q,
        questionType: type,
        correctOptionId: nextIds[0] ?? null,
        ...(nextIds.length > 1 ? { correctOptionIds: nextIds } : { correctOptionIds: undefined }),
        options: q.options.map((o) => ({ ...o, isCorrect: nextIds.includes(o.id) })),
        ...(type === 'free_response' ? { acceptedAnswers: q.acceptedAnswers ?? [] } : {}),
      };
    });
  }

  function handleAcceptedAnswersChange(qId: string, value: string) {
    updateQuestion(qId, (q) => ({
      ...q,
      acceptedAnswers: value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    }));
  }

  function handleAddOption(qId: string) {
    updateQuestion(qId, (q) => {
      const nextIndex = q.options.length;
      const newOpt: QuestionOption = {
        id: `${q.id}-opt-${Date.now()}`,
        label: letterAt(nextIndex),
        text: '',
        isCorrect: false,
      };
      return { ...q, options: [...q.options, newOpt] };
    });
  }

  function handleRemoveOption(qId: string, optId: string) {
    updateQuestion(qId, (q) => {
      if (q.options.length <= 2) return q;
      const remaining = q.options.filter((o) => o.id !== optId);
      const wasCorrect = q.correctOptionId === optId || q.correctOptionIds?.includes(optId);
      return {
        ...q,
        options: remaining,
        correctOptionId: wasCorrect ? null : q.correctOptionId,
        correctOptionIds: wasCorrect ? undefined : q.correctOptionIds,
        hasKnownAnswer: wasCorrect ? false : q.hasKnownAnswer,
      };
    });
  }

  function handleDeleteQuestion(qId: string) {
    setQuestions((list) => reindex(list.filter((q) => q.id !== qId)));
    info('Question deleted');
  }

  function handleAddQuestion() {
    const id = `manual-${Date.now()}`;
    const options: QuestionOption[] = LETTERS.slice(0, 4)
      .split('')
      .map((label, index) => ({
        id: `${id}-opt-${index + 1}`,
        label,
        text: '',
        isCorrect: false,
      }));
    setQuestions((list) =>
      reindex([
        ...list,
        {
          id,
          index: list.length + 1,
          prompt: '',
          options,
          correctOptionId: null,
          hasKnownAnswer: false,
          confidence: 'low',
          questionType: 'single_choice',
          answerStatus: 'needs_review',
          verificationLevel: 1,
          pageNumber: undefined,
          sourceReference: 'Added manually',
        },
      ]),
    );
    success('New question added to library');
  }

  function handleMergeNext(qId: string) {
    setQuestions((list) => {
      const index = list.findIndex((q) => q.id === qId);
      if (index < 0 || index >= list.length - 1) return list;
      const current = list[index];
      const next = list[index + 1];
      const offset = current.options.length;
      const mergedOptions = [
        ...current.options,
        ...next.options.map((option, optionIndex) => ({
          ...option,
          id: `${current.id}-merged-${optionIndex + 1}`,
          label: letterAt(offset + optionIndex),
          isCorrect: undefined,
        })),
      ];
      const merged: Question = {
        ...current,
        prompt: `${current.prompt}\n\n${next.prompt}`.trim(),
        options: mergedOptions,
        correctOptionId: null,
        correctOptionIds: undefined,
        hasKnownAnswer: false,
        answerStatus: 'needs_review',
        verificationLevel: 1,
        disputeExplanation: 'Questions were merged manually. Set and confirm the answer.',
      };
      return reindex([...list.slice(0, index), merged, ...list.slice(index + 2)]);
    });
    info('Merged question with next item');
  }

  function handleSplit(qId: string) {
    setQuestions((list) => {
      const index = list.findIndex((q) => q.id === qId);
      if (index < 0) return list;
      const q = list[index];
      if (q.options.length < 4) {
        error('A question needs at least 4 options to split safely.');
        return list;
      }
      const half = Math.ceil(q.options.length / 2);
      const firstOptions = q.options.slice(0, half).map((o, i) => ({
        ...o,
        label: letterAt(i),
        isCorrect: undefined,
      }));
      const secondOptions = q.options.slice(half).map((o, i) => ({
        ...o,
        id: `${q.id}-split-${i + 1}`,
        label: letterAt(i),
        isCorrect: undefined,
      }));
      const first: Question = {
        ...q,
        options: firstOptions,
        correctOptionId: null,
        correctOptionIds: undefined,
        hasKnownAnswer: false,
        answerStatus: 'needs_review',
        prompt: `${q.prompt} (part 1)`,
        disputeExplanation: 'Split manually. Set and confirm the answer.',
      };
      const second: Question = {
        ...q,
        id: `${q.id}-split`,
        prompt: `${q.prompt} (part 2)`,
        options: secondOptions,
        correctOptionId: null,
        correctOptionIds: undefined,
        hasKnownAnswer: false,
        answerStatus: 'needs_review',
        verificationLevel: 1,
        disputeExplanation: 'Split manually. Set and confirm the answer.',
      };
      return reindex([...list.slice(0, index), first, second, ...list.slice(index + 1)]);
    });
    info('Split question into two parts');
  }

  async function solveQuestionsWithAi(targets: Question[]) {
    if (targets.length === 0) {
      error('No questions matched this AI action.');
      return;
    }
    setAiBusy(targets.length === 1 ? targets[0].id : 'all');
    setAiNotice(null);
    try {
      const result = await postJson<{
        questions: Question[];
        solvedCount: number;
        disputedCount: number;
        verifiedCount: number;
        warnings: string[];
        verificationNote?: string;
      }>('/api/ai/solve', {
        questions: targets,
        checkOfficialAnswers: true,
        maxQuestions: Math.min(targets.length, 30),
      });
      const byId = new Map(result.questions.map((q) => [q.id, q]));
      setQuestions((list) => list.map((q) => byId.get(q.id) ?? q));
      const msg = `Solved ${result.solvedCount} question(s); ${result.disputedCount} disputed, ${result.verifiedCount} verified.`;
      setAiNotice({ tone: 'ok', text: msg });
      success(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI solving failed.';
      setAiNotice({ tone: 'err', text: msg });
      error(msg);
    } finally {
      setAiBusy(null);
    }
  }

  async function explainWithAi(question: Question, mode: 'simpler' | 'steps' | 'example') {
    setAiBusy(question.id);
    try {
      const result = await postJson<ExplanationState>('/api/ai/explain', { question, mode });
      setExplanations((prev) => ({ ...prev, [question.id]: result }));
      success('Explanation generated');
    } catch (err) {
      error(err instanceof Error ? err.message : 'Explanation failed.');
    } finally {
      setAiBusy(null);
    }
  }

  async function challengeWithAi(question: Question) {
    setAiBusy(question.id);
    try {
      const currentLabel =
        question.officialAnswerLabel ??
        question.options.find((o) => o.id === question.correctOptionId)?.label ??
        question.aiSolution?.answer;
      const result = await postJson<{
        solution: { explanation: string };
        labels: string[];
        changed: boolean;
      }>('/api/ai/challenge', { question, currentAnswerLabel: currentLabel });
      setChallenges((prev) => ({
        ...prev,
        [question.id]: `${result.changed ? 'The AI challenged and revised the answer to ' : 'The AI evaluated and upheld '}${
          result.labels.join(', ') || 'the current answer'
        }. ${result.solution.explanation}`,
      }));
      info('Answer evaluated by challenge model');
    } catch (err) {
      error(err instanceof Error ? err.message : 'Challenge failed.');
    } finally {
      setAiBusy(null);
    }
  }

  async function addSimilarWithAi(question: Question) {
    setAiBusy(question.id);
    try {
      const result = await postJson<{ questions: Question[] }>('/api/ai/similar', {
        question,
        count: 3,
      });
      setQuestions((list) => reindex([...list, ...result.questions]));
      success(`Added ${result.questions.length} AI-generated similar questions`);
    } catch (err) {
      error(err instanceof Error ? err.message : 'Could not generate questions.');
    } finally {
      setAiBusy(null);
    }
  }

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: questions.length };
    for (const q of questions) {
      map[q.answerStatus] = (map[q.answerStatus] ?? 0) + 1;
      if (q.confidence === 'low') map.low_confidence = (map.low_confidence ?? 0) + 1;
      if (q.questionType === 'free_response') map.free_response = (map.free_response ?? 0) + 1;
    }
    return map;
  }, [questions]);

  const unkeyedCount = questions.filter((q) => !q.hasKnownAnswer).length;
  const aiCandidates = questions.filter((q) => !q.hasKnownAnswer && !q.hasDiagram);

  const visibleQuestions = questions.filter((q) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchPrompt = q.prompt.toLowerCase().includes(query);
      const matchTopic = (q.subjectTopic ?? '').toLowerCase().includes(query);
      const matchOptions = q.options.some((o) => o.text.toLowerCase().includes(query));
      if (!matchPrompt && !matchTopic && !matchOptions) return false;
    }
    if (filter === 'all') return true;
    if (filter === 'low_confidence') return q.confidence === 'low';
    if (filter === 'free_response') return q.questionType === 'free_response';
    return q.answerStatus === filter;
  });

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All Questions' },
    { key: 'official_answer', label: 'Official Key' },
    { key: 'user_confirmed', label: 'Confirmed' },
    { key: 'ai_verified', label: 'AI Verified' },
    { key: 'ai_proposed', label: 'AI Proposed' },
    { key: 'disputed', label: 'Disputed' },
    { key: 'needs_review', label: 'Needs Review' },
    { key: 'unanswered', label: 'Unkeyed' },
    { key: 'free_response', label: 'Free Response' },
    { key: 'low_confidence', label: 'Low Confidence' },
  ];

  return (
    <section aria-labelledby="reviewTitle" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h2 id="reviewTitle" style={{ margin: 0, fontSize: '24px' }}>
            Question Library & Review — {examTitle}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
            {questions.length} questions total ({questions.length - unkeyedCount} verified keys, {unkeyedCount} unkeyed). Official source keys are strictly preserved.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn secondary" type="button" onClick={onCancel}>
            Back
          </button>
          <button className="btn secondary" type="button" onClick={() => onStartShuffle(questions)}>
            Shuffle Mode
          </button>
          <button className="btn secondary" type="button" onClick={() => onStartPractice(questions)}>
            Practice Mode
          </button>
          <button className="btn primary" type="button" onClick={() => onStartExam(questions)}>
            Start Full Exam
          </button>
        </div>
      </div>

      {processingReport && <ProcessingReport report={processingReport} compact />}

      {/* AI Solver & Add Toolbar */}
      <div className="card" style={{ padding: '16px', background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span className={`badge ${aiStatus?.configured ? 'ok' : 'warn'}`}>
              <IconSparkles size={13} />
              {aiStatus
                ? aiStatus.configured
                  ? `AI: ${aiStatus.provider}/${aiStatus.model}`
                  : 'AI Not Configured'
                : 'AI Status Unknown'}
            </span>
            {aiStatus?.configured && !aiStatus.verifierConfigured && (
              <span className="badge warn">Verifier: Deterministic Math</span>
            )}
            <button
              className="btn secondary sm"
              type="button"
              disabled={!aiEnabled || aiBusy !== null || aiCandidates.length === 0}
              onClick={() => void solveQuestionsWithAi(aiCandidates.slice(0, 30))}
            >
              {aiBusy === 'all' ? (
                <>
                  <IconRotateCw size={14} className="animate-spin" /> Solving...
                </>
              ) : (
                `Solve ${aiCandidates.length} unkeyed with AI`
              )}
            </button>
          </div>

          <button className="btn primary sm" type="button" onClick={handleAddQuestion}>
            <IconPlus size={15} /> Add Custom Question
          </button>
        </div>

        {aiNotice && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              background: aiNotice.tone === 'err' ? 'var(--status-err-bg)' : 'var(--status-ok-bg)',
              color: aiNotice.tone === 'err' ? 'var(--status-err-text)' : 'var(--status-ok-text)',
              border: `1px solid ${aiNotice.tone === 'err' ? 'var(--status-err-border)' : 'var(--status-ok-border)'}`,
            }}
          >
            {aiNotice.text}
          </div>
        )}
      </div>

      {/* Search and Filters Bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <IconSearch
              size={16}
              style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}
            />
            <input
              type="search"
              placeholder="Filter questions by text, options, or topic..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: '36px' }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {filters.map((item) => {
            const count = counts[item.key] ?? 0;
            if (item.key !== 'all' && count === 0) return null;
            return (
              <button
                key={item.key}
                className={`btn sm ${filter === item.key ? 'primary' : 'ghost'}`}
                type="button"
                onClick={() => setFilter(item.key)}
              >
                {item.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Question Cards List */}
      {visibleQuestions.length === 0 ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
          No questions match your filter criteria or search query.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {visibleQuestions.map((q, index) => {
            const meta = statusMeta(q.answerStatus);
            const isMulti = q.questionType === 'multiple_choice';
            const isFree = q.questionType === 'free_response' || q.options.length === 0;
            const busy = aiBusy === q.id;
            const explanation = explanations[q.id];
            const isDisputed = q.answerStatus === 'disputed';

            return (
              <article key={q.id} className={`review-card${isDisputed ? ' disputed' : ''}`}>
                {/* Header row */}
                <div className="review-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: '15px' }}>#{q.index ?? index + 1}</strong>
                    <span className={`badge ${meta.className}`}>{meta.label}</span>
                    {q.pageNumber && <span className="badge">Page {q.pageNumber}</span>}
                    {q.confidence === 'low' && <span className="badge err">Low Confidence OCR</span>}
                    {q.hasDiagram && <span className="badge warn">Has Diagram</span>}
                    {q.isAiGenerated && <span className="badge accent">AI Generated</span>}
                  </div>

                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      className="btn sm ghost"
                      type="button"
                      onClick={() => handleMergeNext(q.id)}
                      disabled={index === visibleQuestions.length - 1}
                      title="Merge with next question below"
                    >
                      Merge Down
                    </button>
                    <button
                      className="btn sm ghost"
                      type="button"
                      onClick={() => handleSplit(q.id)}
                      title="Split question in half"
                    >
                      Split
                    </button>
                    <button
                      className="btn sm danger"
                      type="button"
                      onClick={() => handleDeleteQuestion(q.id)}
                      title="Delete question"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>

                {/* Prompt & Subject Tag */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input
                      type="text"
                      placeholder="Subject Topic (e.g. Mathematics, Organic Chemistry)"
                      value={q.subjectTopic ?? ''}
                      onChange={(e) => handleTopicChange(q.id, e.target.value)}
                      style={{ fontSize: '12.5px', padding: '4px 8px', maxWidth: '320px' }}
                    />
                    <select
                      value={q.questionType ?? 'single_choice'}
                      onChange={(e) => handleQuestionTypeChange(q.id, e.target.value as QuestionType)}
                      style={{ fontSize: '12.5px', padding: '4px 8px' }}
                    >
                      <option value="single_choice">Single Choice</option>
                      <option value="multiple_choice">Multiple Answers</option>
                      <option value="true_false">True / False</option>
                      <option value="free_response">Free Response</option>
                    </select>
                  </div>

                  <textarea
                    rows={3}
                    className="review-prompt-input"
                    value={q.prompt}
                    placeholder="Enter question text..."
                    onChange={(e) => handlePromptChange(q.id, e.target.value)}
                  />
                </div>

                {/* Free response vs Options */}
                {isFree ? (
                  <div>
                    <label style={{ display: 'block', fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                      Accepted answers (one per line, evaluated case-insensitively):
                    </label>
                    <textarea
                      rows={2}
                      className="review-prompt-input"
                      value={(q.acceptedAnswers ?? []).join('\n')}
                      placeholder="Enter accepted answers..."
                      onChange={(e) => handleAcceptedAnswersChange(q.id, e.target.value)}
                    />
                  </div>
                ) : (
                  <div className="review-options-list">
                    <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginBottom: '2px' }}>
                      Options — select the correct answer key:
                    </div>
                    {q.options.map((opt) => (
                      <div key={opt.id} className="review-option-row">
                        <input
                          type={isMulti ? 'checkbox' : 'radio'}
                          id={`opt-choice-${opt.id}`}
                          name={`correct-${q.id}`}
                          checked={
                            isMulti
                              ? Boolean(q.correctOptionIds?.includes(opt.id) || q.correctOptionId === opt.id)
                              : q.correctOptionId === opt.id
                          }
                          onChange={() => handleSetCorrectOption(q.id, opt.id)}
                          style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer', width: '18px', height: '18px' }}
                        />
                        <span style={{ minWidth: '22px', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {opt.label}.
                        </span>
                        <input
                          type="text"
                          className="review-option-input"
                          value={opt.text}
                          onChange={(e) => handleOptionTextChange(q.id, opt.id, e.target.value)}
                          placeholder={`Option ${opt.label} text`}
                        />
                        {q.options.length > 2 && (
                          <button
                            className="btn ghost sm icon-only"
                            type="button"
                            onClick={() => handleRemoveOption(q.id, opt.id)}
                            aria-label={`Remove option ${opt.label}`}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                      <button className="btn ghost sm" type="button" onClick={() => handleAddOption(q.id)}>
                        <IconPlus size={14} /> Add Option
                      </button>
                      {q.hasKnownAnswer && (
                        <button className="btn ghost sm" type="button" onClick={() => handleClearAnswer(q.id)}>
                          Clear Answer
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Dispute Resolution Banner */}
                {isDisputed && (
                  <div
                    style={{
                      background: 'var(--status-err-bg)',
                      border: '1px solid var(--status-err-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--status-err-text)' }}>
                      <IconAlertTriangle size={16} />
                      <strong style={{ fontSize: '13.5px' }}>Disputed Answer Key Detected</strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)' }}>
                      {q.disputeExplanation ?? 'The official document answer and proposed reasoning disagree.'}
                    </p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {q.officialCorrectOptionId && (
                        <button className="btn sm secondary" onClick={() => handleRestoreOfficial(q.id)}>
                          Keep Official Key ({q.officialAnswerLabel ?? 'Source'})
                        </button>
                      )}
                      {q.aiSolution && (
                        <button className="btn sm secondary" onClick={() => handleAcceptAi(q.id)}>
                          Accept AI Proposal ({q.aiSolution.answer})
                        </button>
                      )}
                      <button className="btn sm primary" onClick={() => handleConfirm(q.id)}>
                        Confirm Current Selection (Level 4)
                      </button>
                    </div>
                  </div>
                )}

                {/* AI Solution Details */}
                {q.aiSolution && !isDisputed && (
                  <details
                    style={{
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 14px',
                      fontSize: '13.5px',
                    }}
                  >
                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                      AI Analysis: {q.aiSolution.answer} (Confidence: {q.aiSolution.confidence})
                    </summary>
                    <p style={{ margin: '8px 0 4px', color: 'var(--text-primary)' }}>{q.aiSolution.explanation}</p>
                    {q.aiSolution.verificationMethod && (
                      <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        Verification: {q.aiSolution.verificationMethod}
                      </div>
                    )}
                  </details>
                )}

                {/* Inline Explanation */}
                {explanation && (
                  <div style={{ background: 'var(--bg-subtle)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                    <strong>Explanation:</strong>
                    <p style={{ margin: '6px 0 0', fontSize: '13.5px' }}>{explanation.explanation}</p>
                    {explanation.keyPoints?.length > 0 && (
                      <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12.5px' }}>
                        {explanation.keyPoints.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Inline Challenge result */}
                {challenges[q.id] && (
                  <div style={{ background: 'var(--bg-subtle)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '13px' }}>
                    <strong>Challenge result:</strong> {challenges[q.id]}
                  </div>
                )}

                {/* Action Buttons row */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                  <button
                    className="btn sm secondary"
                    type="button"
                    disabled={!aiEnabled || busy}
                    onClick={() => void solveQuestionsWithAi([q])}
                  >
                    {busy ? 'Evaluating...' : 'AI Solve / Check'}
                  </button>
                  <button
                    className="btn sm ghost"
                    type="button"
                    disabled={!aiEnabled || busy}
                    onClick={() => void explainWithAi(q, 'simpler')}
                  >
                    Explain Simply
                  </button>
                  <button
                    className="btn sm ghost"
                    type="button"
                    disabled={!aiEnabled || busy}
                    onClick={() => void explainWithAi(q, 'steps')}
                  >
                    Step-by-Step
                  </button>
                  <button
                    className="btn sm ghost"
                    type="button"
                    disabled={!aiEnabled || busy}
                    onClick={() => void challengeWithAi(q)}
                  >
                    Challenge Answer
                  </button>
                  <button
                    className="btn sm ghost"
                    type="button"
                    disabled={!aiEnabled || busy}
                    onClick={() => void addSimilarWithAi(q)}
                  >
                    Similar Question
                  </button>
                  <button
                    className="btn sm primary"
                    type="button"
                    disabled={!q.hasKnownAnswer && (q.acceptedAnswers?.length ?? 0) === 0}
                    onClick={() => handleConfirm(q.id)}
                  >
                    <IconCheck size={14} /> Confirm Answer (L4)
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Bottom Sticky Action */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '16px' }}>
        <button className="btn primary lg" type="button" onClick={() => onStartPractice(questions)}>
          Practice these {questions.length} Questions
        </button>
      </div>
    </section>
  );
}
