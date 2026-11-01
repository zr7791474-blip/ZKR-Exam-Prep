'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { computeWeakTopics } from '../lib/exam/analytics';
import { isReliableAnswer, scoreAttempt } from '../lib/exam/scoring';
import { shuffleExercise } from '../lib/exam/shuffle';
import type {
  AICapabilityStatus,
  AnswerStatus,
  AnswerValue,
  ExamAttempt,
  ExamMode,
  Question,
} from '../lib/models/exam';
import { saveAttempt } from '../lib/storage/history';
import {
  IconCheck,
  IconClock,
  IconArrowLeft,
  IconArrowRight,
  IconFlag,
} from './ui/icons';
import { useToast } from './ui/Toast';

interface PracticeSessionProps {
  initialQuestions: Question[];
  examTitle: string;
  mode: ExamMode;
  onComplete: (attempt: ExamAttempt) => void;
  onExit: () => void;
  aiStatus?: AICapabilityStatus | null;
}

interface ExplanationState {
  explanation: string;
  keyPoints: string[];
  commonMistake: string;
  confidence: string;
}

function isFreeResponse(question: Question): boolean {
  return question.questionType === 'free_response' || question.options.length === 0;
}

function isMultiAnswer(question: Question): boolean {
  return question.questionType === 'multiple_choice';
}

function normaliseFreeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const LETTERS = 'ABCDEFGHIJ';

function letterAt(index: number): string {
  return LETTERS[index] ?? String(index + 1);
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

function statusMeta(status: AnswerStatus): { label: string; className: string } {
  switch (status) {
    case 'official_answer':
      return { label: 'Official Key', className: 'ok' };
    case 'user_confirmed':
      return { label: 'Confirmed by You', className: 'ok' };
    case 'ai_verified':
      return { label: 'AI Verified', className: 'ok' };
    case 'ai_proposed':
      return { label: 'AI Proposed (Unscored)', className: 'warn' };
    case 'disputed':
      return { label: 'Disputed (Unscored)', className: 'err' };
    case 'needs_review':
      return { label: 'Needs Review', className: 'warn' };
    default:
      return { label: 'No Verified Answer', className: 'warn' };
  }
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

export function PracticeSession({
  initialQuestions,
  examTitle,
  mode,
  onComplete,
  onExit,
  aiStatus,
}: PracticeSessionProps) {
  const [questions, setQuestions] = useState<Question[]>(() =>
    mode === 'shuffle' ? shuffleExercise(initialQuestions) : initialQuestions,
  );

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [freeTextAnswers, setFreeTextAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [flagged, setFlagged] = useState<Record<string, boolean>>({});
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
  const [startedAt] = useState(() => new Date().toISOString());
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [explanations, setExplanations] = useState<Record<string, ExplanationState>>({});
  const [challenges, setChallenges] = useState<Record<string, string>>({});
  const { success, error, info } = useToast();

  const currentQ = questions[currentIndex];
  const aiEnabled = aiStatus ? aiStatus.configured : true;

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedIds = useMemo(() => {
    if (!currentQ) return [];
    const value = answers[currentQ.id];
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }, [answers, currentQ]);

  const isRevealed = currentQ ? revealed[currentQ.id] ?? false : false;

  const isAnswered = useCallback(
    (question: Question): boolean => {
      if (isFreeResponse(question)) return (freeTextAnswers[question.id] ?? '').trim().length > 0;
      const value = answers[question.id];
      if (Array.isArray(value)) return value.filter(Boolean).length > 0;
      return Boolean(value);
    },
    [answers, freeTextAnswers],
  );

  const answeredCount = questions.filter(isAnswered).length;
  const unansweredCount = questions.length - answeredCount;
  const progressPercent = Math.round((answeredCount / questions.length) * 100);

  const handleSelectOption = useCallback(
    (optionId: string) => {
      if (!currentQ) return;
      setAnswers((prev) => {
        if (isMultiAnswer(currentQ)) {
          const current = Array.isArray(prev[currentQ.id])
            ? (prev[currentQ.id] as string[]).filter(Boolean)
            : prev[currentQ.id]
              ? [prev[currentQ.id] as string]
              : [];
          const next = current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId];
          return { ...prev, [currentQ.id]: next.length > 0 ? next : null };
        }
        return {
          ...prev,
          [currentQ.id]: prev[currentQ.id] === optionId ? null : optionId,
        };
      });
    },
    [currentQ],
  );

  function handleFreeTextChange(questionId: string, value: string) {
    setFreeTextAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function handleCheckAnswer() {
    if (!currentQ) return;
    setRevealed((prev) => ({ ...prev, [currentQ.id]: true }));
  }

  const toggleFlag = useCallback(() => {
    if (!currentQ) return;
    setFlagged((prev) => {
      const next = !prev[currentQ.id];
      if (next) info(`Question #${currentIndex + 1} flagged for review`);
      return { ...prev, [currentQ.id]: next };
    });
  }, [currentQ, currentIndex, info]);

  function buildAttempt(): ExamAttempt {
    const summary = scoreAttempt(questions, answers, freeTextAnswers);
    const weakTopics = computeWeakTopics(questions, answers, freeTextAnswers);
    const flaggedIds = questions
      .filter(
        (q) =>
          q.answerStatus === 'disputed' ||
          q.answerStatus === 'needs_review' ||
          q.answerStatus === 'ai_proposed' ||
          flagged[q.id],
      )
      .map((q) => q.id);
    const revisionQuestionIds = [
      ...new Set([...summary.mistakes.map((mistake) => mistake.question.id), ...flaggedIds]),
    ];

    return {
      id: `attempt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      examId: 'active-exam',
      examTitle,
      startedAt,
      completedAt: new Date().toISOString(),
      mode,
      answers,
      freeTextAnswers,
      totalQuestions: summary.totalQuestions,
      knownAnswerQuestions: summary.knownAnswerQuestions,
      unknownAnswerQuestions: summary.unknownAnswerQuestions,
      answeredCount: summary.answeredCount,
      correctCount: summary.correctCount,
      incorrectCount: summary.incorrectCount,
      scorePercentage: summary.scorePercentage,
      reliableKnownAnswerQuestions: summary.knownAnswerQuestions,
      aiProposedCount: summary.aiProposedQuestions ?? 0,
      disputedCount: summary.disputedQuestions ?? 0,
      questionsSnapshot: questions,
      weakTopics,
      revisionQuestionIds,
    };
  }

  function submitAttempt() {
    const attempt = buildAttempt();
    saveAttempt(attempt);
    success('Session completed and saved');
    onComplete(attempt);
  }

  function handleFinish() {
    if (unansweredCount > 0 && !showConfirmSubmit) {
      setShowConfirmSubmit(true);
      return;
    }
    submitAttempt();
  }

  async function explainWithAi(question: Question, explainMode: 'simpler' | 'steps' | 'example') {
    setAiBusy(question.id);
    setAiNotice(null);
    try {
      const result = await postJson<ExplanationState>('/api/ai/explain', {
        question,
        mode: explainMode,
      });
      setExplanations((prev) => ({ ...prev, [question.id]: result }));
    } catch (err) {
      setAiNotice({ tone: 'err', text: err instanceof Error ? err.message : 'Explanation failed.' });
    } finally {
      setAiBusy(null);
    }
  }

  async function challengeWithAi(question: Question) {
    setAiBusy(question.id);
    setAiNotice(null);
    try {
      const currentLabel =
        question.officialAnswerLabel ??
        question.options.find((option) => option.id === question.correctOptionId)?.label ??
        question.aiSolution?.answer;
      const result = await postJson<{
        solution: { explanation: string };
        labels: string[];
        changed: boolean;
      }>('/api/ai/challenge', { question, currentAnswerLabel: currentLabel });
      setChallenges((prev) => ({
        ...prev,
        [question.id]: `${result.changed ? 'The AI changed its answer to ' : 'The AI upheld '}${
          result.labels.join(', ') || 'the current answer'
        }. ${result.solution.explanation}`,
      }));
    } catch (err) {
      setAiNotice({ tone: 'err', text: err instanceof Error ? err.message : 'Challenge failed.' });
    } finally {
      setAiBusy(null);
    }
  }

  async function addSimilarWithAi(question: Question) {
    setAiBusy(question.id);
    setAiNotice(null);
    try {
      const result = await postJson<{ questions: Question[] }>('/api/ai/similar', {
        question,
        count: 3,
      });
      setQuestions((list) => [
        ...list,
        ...result.questions.map((item, index) => ({ ...item, index: list.length + index + 1 })),
      ]);
      setAiNotice({
        tone: 'ok',
        text: `Added ${result.questions.length} AI-generated practice question(s).`,
      });
      success(`Added ${result.questions.length} similar practice questions`);
    } catch (err) {
      setAiNotice({
        tone: 'err',
        text: err instanceof Error ? err.message : 'Could not generate questions.',
      });
      error('Could not generate similar questions');
    } finally {
      setAiBusy(null);
    }
  }

  // Keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLSelectElement) return;

      if (e.key === 'ArrowRight' && currentIndex < questions.length - 1) {
        setCurrentIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((i) => i - 1);
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFlag();
      } else if (['1', '2', '3', '4', '5', '6', '7', '8', '9'].includes(e.key)) {
        const optIdx = parseInt(e.key, 10) - 1;
        if (currentQ?.options[optIdx]) {
          handleSelectOption(currentQ.options[optIdx].id);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, currentQ, questions.length, handleSelectOption, toggleFlag]);

  if (!currentQ) {
    return (
      <div className="card" style={{ padding: '40px', textAlign: 'center' }}>
        No questions available in this session.
      </div>
    );
  }

  const isPractice = mode === 'practice';
  const isShuffle = mode === 'shuffle';
  const freeResponse = isFreeResponse(currentQ);
  const multiAnswer = isMultiAnswer(currentQ);
  const reliable = isReliableAnswer(currentQ);
  const correctIds = correctIdsFor(currentQ);
  const meta = statusMeta(currentQ.answerStatus);
  const explanation = explanations[currentQ.id];
  const challenge = challenges[currentQ.id];
  const busy = aiBusy === currentQ.id;
  const isFlagged = flagged[currentQ.id] ?? false;

  const currentCorrect = (() => {
    if (!reliable) return false;
    if (freeResponse) {
      const actual = normaliseFreeText(freeTextAnswers[currentQ.id] ?? '');
      const accepted = (currentQ.acceptedAnswers ?? []).map(normaliseFreeText).filter(Boolean);
      return actual.length > 0 && accepted.some((value) => value === actual);
    }
    return setsEqual(selectedIds, correctIds);
  })();

  const correctLabels = currentQ.options
    .filter((option) => correctIds.includes(option.id))
    .map((option) => option.label)
    .join(', ');

  return (
    <section aria-labelledby="sessionTitle" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header Bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <h2 id="sessionTitle" style={{ margin: 0, fontSize: '22px' }}>
              {examTitle}
            </h2>
            <span className="badge accent">
              {isShuffle ? 'Shuffled Practice' : isPractice ? 'Interactive Practice' : 'Simulated Exam'}
            </span>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '13px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-subtle)',
                padding: '3px 8px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <IconClock size={14} />
              <span>{formatTimer(secondsElapsed)}</span>
            </div>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '13.5px' }}>
            Question {currentIndex + 1} of {questions.length} ({answeredCount} answered, {unansweredCount} remaining)
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn secondary" type="button" onClick={onExit}>
            Exit Session
          </button>
          <button className="btn primary" type="button" onClick={handleFinish}>
            Finish {isPractice ? 'Practice' : 'Exam'}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ height: '6px', background: 'var(--bg-subtle)', borderRadius: '3px', overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, #6366f1, #38bdf8)',
            transition: 'width 0.25s ease',
          }}
        />
      </div>

      {aiNotice && (
        <div
          style={{
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

      {/* Palette Navigation */}
      <div className="card" style={{ padding: '14px 16px', background: 'var(--bg-surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>
            QUESTION PALETTE ({answeredCount}/{questions.length} ANSWERED)
          </span>
          <div style={{ display: 'flex', gap: '10px', fontSize: '11.5px', color: 'var(--text-tertiary)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)' }} />
              Current
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--status-warn)' }} />
              Flagged
            </span>
          </div>
        </div>

        <div className="palette-grid" role="navigation" aria-label="Question palette">
          {questions.map((q, idx) => {
            const isCurr = idx === currentIndex;
            const isAns = isAnswered(q);
            const isFlg = flagged[q.id];
            return (
              <button
                key={q.id}
                type="button"
                className={`palette-num ${isCurr ? 'current' : ''} ${isAns ? 'answered' : ''} ${isFlg ? 'flagged' : ''}`}
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Go to question ${idx + 1}${isAns ? ' (Answered)' : ''}`}
                aria-current={isCurr ? 'step' : undefined}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Question Card */}
      <article className="question-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '18px' }}>Question {currentIndex + 1}</span>
            <span className={`badge ${meta.className}`}>{meta.label}</span>
            {currentQ.hasDiagram && <span className="badge warn">Diagram Referenced</span>}
            {currentQ.isAiGenerated && <span className="badge accent">AI Generated</span>}
            {currentQ.pageNumber && <span className="badge">Page {currentQ.pageNumber}</span>}
          </div>

          <button
            type="button"
            className={`btn sm ${isFlagged ? 'primary' : 'ghost'}`}
            onClick={toggleFlag}
            title="Flag question to review later (Hotkey: F)"
          >
            <IconFlag size={14} /> {isFlagged ? 'Flagged for Review' : 'Flag Question (F)'}
          </button>
        </div>

        {/* Prompt */}
        <p className="question-prompt">{currentQ.prompt}</p>

        {multiAnswer && !freeResponse && (
          <div style={{ fontSize: '13px', color: 'var(--status-warn-text)', background: 'var(--status-warn-bg)', padding: '6px 12px', borderRadius: 'var(--radius-sm)' }}>
            Multiple Selection Question: Select every correct option.
          </div>
        )}

        {/* Option choices or Free Text */}
        {freeResponse ? (
          <div>
            <label htmlFor={`free-${currentQ.id}`} style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Your Answer (type below):
            </label>
            <textarea
              id={`free-${currentQ.id}`}
              className="review-prompt-input"
              rows={4}
              value={freeTextAnswers[currentQ.id] ?? ''}
              onChange={(e) => handleFreeTextChange(currentQ.id, e.target.value)}
              placeholder="Type your response here..."
            />
          </div>
        ) : (
          <div className="options-list">
            {currentQ.options.map((opt, optIndex) => {
              const isSelected = selectedIds.includes(opt.id);
              let feedbackClass = '';

              if (isPractice && isRevealed && reliable) {
                if (correctIds.includes(opt.id)) {
                  feedbackClass = 'correct';
                } else if (isSelected) {
                  feedbackClass = 'wrong';
                }
              }

              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`option-choice ${isSelected ? 'selected' : ''} ${feedbackClass}`}
                  onClick={() => handleSelectOption(opt.id)}
                  aria-pressed={isSelected}
                >
                  <span className="option-letter">
                    {opt.label || letterAt(optIndex)}
                  </span>
                  <span style={{ flex: 1 }}>{opt.text}</span>
                  <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                    [{optIndex + 1}]
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Practice Mode Instant Check Button & Feedback */}
        {isPractice && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <button
              className="btn secondary"
              type="button"
              disabled={!isAnswered(currentQ)}
              onClick={handleCheckAnswer}
            >
              <IconCheck size={16} /> Check Answer
            </button>

            {isRevealed && (
              <div style={{ fontSize: '14px', flex: 1, minWidth: '240px' }}>
                {!reliable ? (
                  <span style={{ color: 'var(--text-secondary)' }}>
                    ⓘ This question has no reliable answer key. Your answer is recorded but excluded from scores.
                  </span>
                ) : currentCorrect ? (
                  <span style={{ color: 'var(--status-ok-text)', fontWeight: 600 }}>
                    ✓ Correct answer! Verified accuracy recorded.
                  </span>
                ) : (
                  <span style={{ color: 'var(--status-err-text)', fontWeight: 600 }}>
                    ✕ Incorrect.{' '}
                    {freeResponse
                      ? `Accepted: ${(currentQ.acceptedAnswers ?? []).join(' / ') || 'not specified'}.`
                      : `The correct answer is ${correctLabels || 'not available'}.`}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* AI Explanations & Assistance (in Practice Mode) */}
        {isPractice && (explanation || challenge) && (
          <div
            style={{
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '14px',
              fontSize: '13.5px',
            }}
          >
            {explanation && (
              <>
                <strong style={{ color: 'var(--text-primary)' }}>
                  Reasoning & Explanation ({explanation.confidence} confidence):
                </strong>
                <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)' }}>{explanation.explanation}</p>
                {explanation.keyPoints?.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: '18px', color: 'var(--text-secondary)' }}>
                    {explanation.keyPoints.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                )}
                {explanation.commonMistake && (
                  <p style={{ margin: '8px 0 0', color: 'var(--status-warn-text)', fontSize: '13px' }}>
                    Common Pitfall: {explanation.commonMistake}
                  </p>
                )}
              </>
            )}
            {challenge && (
              <p style={{ margin: explanation ? '10px 0 0' : 0, color: 'var(--text-primary)' }}>
                <strong>Challenge Result:</strong> {challenge}
              </p>
            )}
          </div>
        )}

        {/* Optional AI Study Tools Accordion */}
        {isPractice && (
          <details style={{ background: 'var(--bg-subtle)', padding: '10px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', fontSize: '13.5px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              AI Study Assistant Tools
            </summary>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
              <button
                className="btn sm secondary"
                type="button"
                disabled={!aiEnabled || busy}
                onClick={() => void explainWithAi(currentQ, 'simpler')}
              >
                Explain Simply
              </button>
              <button
                className="btn sm secondary"
                type="button"
                disabled={!aiEnabled || busy}
                onClick={() => void explainWithAi(currentQ, 'steps')}
              >
                Step-by-Step
              </button>
              <button
                className="btn sm secondary"
                type="button"
                disabled={!aiEnabled || busy}
                onClick={() => void challengeWithAi(currentQ)}
              >
                Challenge Answer
              </button>
              <button
                className="btn sm secondary"
                type="button"
                disabled={!aiEnabled || busy}
                onClick={() => void addSimilarWithAi(currentQ)}
              >
                Generate Similar Question
              </button>
              {busy && <span style={{ fontSize: '12.5px', color: 'var(--text-tertiary)' }}>Consulting model...</span>}
            </div>
          </details>
        )}

        {/* Prev / Next navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px' }}>
          <button
            className="btn secondary"
            type="button"
            disabled={currentIndex === 0}
            onClick={() => setCurrentIndex((i) => i - 1)}
          >
            <IconArrowLeft size={16} /> Previous
          </button>
          <span style={{ fontSize: '13.5px', color: 'var(--text-secondary)' }}>
            Question {currentIndex + 1} of {questions.length}
          </span>
          {currentIndex < questions.length - 1 ? (
            <button
              className="btn primary"
              type="button"
              onClick={() => setCurrentIndex((i) => i + 1)}
            >
              Next <IconArrowRight size={16} />
            </button>
          ) : (
            <button className="btn primary" type="button" onClick={handleFinish}>
              Finish {isPractice ? 'Practice' : 'Exam'}
            </button>
          )}
        </div>
      </article>

      {/* Confirmation Modal if Unanswered Questions Remain */}
      {showConfirmSubmit && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-box">
            <h3 style={{ margin: 0, fontSize: '18px' }}>Submit with unanswered questions?</h3>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '14px' }}>
              You have answered <strong>{answeredCount}</strong> of <strong>{questions.length}</strong> questions.
              {unansweredCount > 0 && ` There are ${unansweredCount} unanswered question(s) remaining.`}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
              <button className="btn secondary" type="button" onClick={() => setShowConfirmSubmit(false)}>
                Keep Answering
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setShowConfirmSubmit(false);
                  submitAttempt();
                }}
              >
                Submit Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
