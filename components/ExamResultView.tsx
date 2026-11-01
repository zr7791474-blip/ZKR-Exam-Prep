'use client';

import { buildLearningReport } from '../lib/exam/analytics';
import { createFlashcardsFromQuestions } from '../lib/exam/flashcards';
import { scoreAttempt } from '../lib/exam/scoring';
import type { AnswerStatus, ExamAttempt, ExamMode, Question } from '../lib/models/exam';
import { loadFlashcards, mergeFlashcards, saveFlashcards } from '../lib/storage/history';
import {
  IconCheckCircle,
  IconRotateCw,
  IconShuffle,
  IconLayers,
  IconSparkles,
} from './ui/icons';
import { useToast } from './ui/Toast';

interface ExamResultViewProps {
  attempt: ExamAttempt;
  onRetake: (mode: ExamMode) => void;
  onReviewQuestions: () => void;
  onExit: () => void;
  onPracticeQuestions?: (questions: Question[]) => void;
  onOpenFlashcards?: () => void;
}

function statusMeta(status: AnswerStatus): { label: string; className: string } {
  switch (status) {
    case 'official_answer':
      return { label: 'Official Key', className: 'ok' };
    case 'user_confirmed':
      return { label: 'Confirmed Key', className: 'ok' };
    case 'ai_verified':
      return { label: 'AI Verified', className: 'ok' };
    case 'ai_proposed':
      return { label: 'AI Proposed — Excluded from Score', className: 'warn' };
    case 'disputed':
      return { label: 'Disputed — Excluded from Score', className: 'err' };
    case 'needs_review':
      return { label: 'Needs Review', className: 'warn' };
    default:
      return { label: 'No Verified Answer', className: 'warn' };
  }
}

function selectedIdsFor(attempt: ExamAttempt, question: Question): string[] {
  const value = attempt.answers[question.id];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function correctIdsFor(question: Question): string[] {
  if (question.correctOptionIds?.length) return question.correctOptionIds;
  if (question.correctOptionId) return [question.correctOptionId];
  return [];
}

export function ExamResultView({
  attempt,
  onRetake,
  onReviewQuestions,
  onExit,
  onPracticeQuestions,
  onOpenFlashcards,
}: ExamResultViewProps) {
  const { success, warning: toastWarn } = useToast();

  const summary = scoreAttempt(
    attempt.questionsSnapshot,
    attempt.answers,
    attempt.freeTextAnswers ?? {},
  );
  const report = buildLearningReport(attempt);
  const mistakes = summary.mistakes;
  const flaggedQuestions = attempt.questionsSnapshot.filter(
    (question) =>
      question.answerStatus === 'disputed' ||
      question.answerStatus === 'ai_proposed' ||
      question.answerStatus === 'needs_review',
  );

  const questionById = new Map(attempt.questionsSnapshot.map((q) => [q.id, q]));
  const recommendedQuestions = report.recommendedQuestionIds
    .map((id) => questionById.get(id))
    .filter((q): q is Question => Boolean(q));

  function handleCreateFlashcards() {
    const cards = createFlashcardsFromQuestions(attempt.questionsSnapshot);
    if (cards.length === 0) {
      toastWarn('No cards created because no question has a usable answer key.');
      return;
    }
    const merged = mergeFlashcards(loadFlashcards(), cards);
    const saved = saveFlashcards(merged);
    if (saved) {
      success(`${cards.length} flashcard(s) created with SM-2 spaced repetition scheduling.`);
    } else {
      toastWarn('Flashcards could not be stored because browser storage is full or disabled.');
    }
  }

  return (
    <section aria-labelledby="resultTitle" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <h2 id="resultTitle" style={{ margin: 0, fontSize: '24px' }}>
            Results & Mastery — {attempt.examTitle}
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
            Completed {new Date(attempt.completedAt).toLocaleString()} • Mode: <span style={{ textTransform: 'capitalize' }}>{attempt.mode}</span>
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn secondary" type="button" onClick={onExit}>
            Dashboard
          </button>
          <button className="btn secondary" type="button" onClick={onReviewQuestions}>
            Review Library
          </button>
          <button className="btn secondary" type="button" onClick={handleCreateFlashcards}>
            <IconLayers size={15} /> Create Flashcards
          </button>
          {onOpenFlashcards && (
            <button className="btn secondary" type="button" onClick={onOpenFlashcards}>
              Spaced Repetition
            </button>
          )}
          <button className="btn secondary" type="button" onClick={() => onRetake('shuffle')}>
            <IconShuffle size={15} /> Retake Shuffled
          </button>
          <button className="btn primary" type="button" onClick={() => onRetake(attempt.mode)}>
            <IconRotateCw size={15} /> Retake ({attempt.mode})
          </button>
        </div>
      </div>

      {/* Score Hero Card */}
      <div className="score-hero">
        <span className="badge accent" style={{ textTransform: 'capitalize' }}>
          {attempt.mode} Session Report
        </span>
        <div className="score-circle">
          {report.reliableScorePercentage !== null ? `${report.reliableScorePercentage}%` : 'Done'}
        </div>
        <div style={{ fontSize: '17px', color: 'var(--text-primary)', fontWeight: 600 }}>
          {report.reliableScorePercentage !== null
            ? `${report.correctCount} of ${summary.knownAnswerQuestions} verified questions answered correctly`
            : `${report.answeredCount} of ${attempt.totalQuestions} questions answered`}
        </div>

        {summary.unknownAnswerQuestions > 0 && (
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '640px' }}>
            {summary.unknownAnswerQuestions} {summary.unknownAnswerQuestions === 1 ? 'question had' : 'questions had'} no reliable official answer key and {summary.unknownAnswerQuestions === 1 ? 'was' : 'were'} excluded from the percentage score. AI-proposed answers are excluded until confirmed by you.
          </p>
        )}

        {/* Stats Grid */}
        <div className="score-stats">
          <div className="score-stat-item">
            <span className="score-stat-num" style={{ color: 'var(--status-ok-text)' }}>
              {report.correctCount}
            </span>
            <span className="score-stat-lbl">Correct</span>
          </div>

          <div className="score-stat-item">
            <span className="score-stat-num" style={{ color: 'var(--status-err-text)' }}>
              {report.incorrectCount}
            </span>
            <span className="score-stat-lbl">Missed / Skipped</span>
          </div>

          <div className="score-stat-item">
            <span className="score-stat-num">
              {report.answeredCount} / {attempt.totalQuestions}
            </span>
            <span className="score-stat-lbl">Answered</span>
          </div>

          {report.aiProposedCount > 0 && (
            <div className="score-stat-item">
              <span className="score-stat-num" style={{ color: 'var(--status-warn-text)' }}>
                {report.aiProposedCount}
              </span>
              <span className="score-stat-lbl">AI Proposed</span>
            </div>
          )}

          {report.disputedCount > 0 && (
            <div className="score-stat-item">
              <span className="score-stat-num" style={{ color: 'var(--status-err-text)' }}>
                {report.disputedCount}
              </span>
              <span className="score-stat-lbl">Disputed</span>
            </div>
          )}

          {report.needsReviewCount > 0 && (
            <div className="score-stat-item">
              <span className="score-stat-num" style={{ color: 'var(--status-warn-text)' }}>
                {report.needsReviewCount}
              </span>
              <span className="score-stat-lbl">Needs Review</span>
            </div>
          )}
        </div>
      </div>

      {/* Learning & Weak Topics Report */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>Diagnostic Learning Report</h3>
          <span className="badge accent">
            {report.weakTopics.length > 0
              ? `${report.weakTopics.length} weak topic(s) detected`
              : 'Strong baseline — no critical weak topics'}
          </span>
        </div>
        <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: 'var(--text-secondary)' }}>
          {report.summary}
        </p>

        {report.weakTopics.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {report.weakTopics.slice(0, 6).map((topic) => (
              <div key={topic.topic} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{topic.topic}</strong>
                  <span style={{ color: 'var(--status-warn-text)' }}>
                    {topic.incorrectCount} missed of {topic.totalCount} ({topic.accuracy}% accuracy)
                  </span>
                </div>
                <div style={{ height: '7px', borderRadius: '4px', background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.max(4, topic.accuracy)}%`,
                      background: 'linear-gradient(90deg, var(--status-err), var(--status-warn))',
                      borderRadius: '4px',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {recommendedQuestions.length > 0 && (
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
              <h4 style={{ margin: 0, fontSize: '15px' }}>Targeted Revision Drill</h4>
              {onPracticeQuestions && (
                <button
                  className="btn primary sm"
                  type="button"
                  onClick={() => onPracticeQuestions(recommendedQuestions)}
                >
                  <IconSparkles size={14} /> Practice Weak Topics ({recommendedQuestions.length} Questions)
                </button>
              )}
            </div>
            <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {recommendedQuestions.slice(0, 6).map((question) => (
                <li key={question.id}>
                  {question.prompt.length > 130 ? `${question.prompt.slice(0, 130)}…` : question.prompt}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Flagged or Unscored Answers */}
      {flaggedQuestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '17px' }}>Uncertain or Disputed Items</h3>
            <span className="badge warn">{flaggedQuestions.length} not scored</span>
          </div>

          {flaggedQuestions.map((question) => {
            const meta = statusMeta(question.answerStatus);
            return (
              <article key={question.id} className="review-card">
                <div className="review-header">
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <strong>Question {question.index}</strong>
                    <span className={`badge ${meta.className}`}>{meta.label}</span>
                    {question.pageNumber && <span className="badge">Page {question.pageNumber}</span>}
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: 500 }}>{question.prompt}</p>
                {question.disputeExplanation && (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--status-err-text)' }}>
                    <strong>Why it is disputed:</strong> {question.disputeExplanation}
                  </p>
                )}
                {question.aiSolution && (
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <strong>AI proposal:</strong> {question.aiSolution.answer}. {question.aiSolution.explanation}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Mistake Review Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <h3 style={{ margin: 0, fontSize: '18px' }}>Mistake & Question Review</h3>
          <span className={`badge ${mistakes.length === 0 ? 'ok' : 'err'}`}>
            {mistakes.length === 0 ? '0 Mistakes on Reliable Questions' : `${mistakes.length} Mistakes to Review`}
          </span>
        </div>

        {mistakes.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--bg-surface)' }}>
            <IconCheckCircle size={36} style={{ color: 'var(--status-ok-text)', margin: '0 auto 12px' }} />
            <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
              Outstanding Performance!
            </strong>
            <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
              You answered all reliably keyed questions correctly. Ready for another challenge?
            </p>
          </div>
        ) : (
          mistakes.map((mistake, idx) => {
            const question = mistake.question;
            const userSelectedIds = selectedIdsFor(attempt, question);
            const correctIds = correctIdsFor(question);
            const freeResponse =
              question.questionType === 'free_response' || question.options.length === 0;
            const userFreeText = attempt.freeTextAnswers?.[question.id] ?? '';

            return (
              <article key={question.id} className="review-card">
                <div className="review-header">
                  <strong>
                    Mistake #{idx + 1} (Question {question.index})
                  </strong>
                  <span className="badge err">Incorrect Choice</span>
                </div>

                <p style={{ margin: 0, fontSize: '15.5px', fontWeight: 500 }}>{question.prompt}</p>

                {freeResponse ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <p style={{ margin: 0, fontSize: '14px' }}>
                      <strong>Your answer:</strong>{' '}
                      {userFreeText.trim() || <em>No answer provided.</em>}
                    </p>
                    <p style={{ margin: 0, fontSize: '14px', color: 'var(--status-ok-text)' }}>
                      <strong>Accepted answer(s):</strong>{' '}
                      {(question.acceptedAnswers ?? []).join(' / ') || 'None provided'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    {question.options.map((opt) => {
                      const isUserChoice = userSelectedIds.includes(opt.id);
                      const isCorrectChoice = correctIds.includes(opt.id);

                      let optClass = '';
                      if (isCorrectChoice) optClass = 'correct';
                      else if (isUserChoice) optClass = 'wrong';

                      return (
                        <div
                          key={opt.id}
                          className={`option-choice ${optClass}`}
                          style={{ cursor: 'default' }}
                        >
                          <span className="option-letter">{opt.label}</span>
                          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-between' }}>
                            <span>{opt.text}</span>
                            {isUserChoice && !isCorrectChoice && (
                              <span style={{ color: 'var(--status-err-text)', fontWeight: 600, fontSize: '12px' }}>
                                (Your selection)
                              </span>
                            )}
                            {isCorrectChoice && (
                              <span style={{ color: 'var(--status-ok-text)', fontWeight: 600, fontSize: '12px' }}>
                                (Verified answer)
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {question.explanation && (
                  <div style={{ background: 'var(--bg-subtle)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <strong>Explanation:</strong> {question.explanation}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      {/* Bottom Action */}
      {onPracticeQuestions && recommendedQuestions.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '10px' }}>
          <button
            className="btn primary lg"
            type="button"
            onClick={() => onPracticeQuestions(recommendedQuestions)}
          >
            Practice Weak Topics Drill ({recommendedQuestions.length} Questions)
          </button>
        </div>
      )}
    </section>
  );
}
