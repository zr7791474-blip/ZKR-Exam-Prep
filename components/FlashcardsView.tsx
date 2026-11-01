'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createFlashcardsFromQuestions,
  dueFlashcards,
  flashcardStats,
  isFlashcardDue,
  reviewFlashcard,
  type FlashcardGrade,
} from '../lib/exam/flashcards';
import type { FlashcardItem, Question } from '../lib/models/exam';
import {
  loadFlashcards,
  mergeFlashcards,
  saveFlashcards,
} from '../lib/storage/history';
import {
  IconShuffle,
  IconLayers,
  IconCheck,
  IconSparkles,
  IconArrowLeft,
  IconArrowRight,
} from './ui/icons';
import { useToast } from './ui/Toast';

interface FlashcardsViewProps {
  questions?: Question[];
  onExit: () => void;
  onPractice?: (questions: Question[]) => void;
}

function cardToQuestion(card: FlashcardItem, index: number): Question {
  const questionType =
    card.options.length === 0
      ? 'free_response'
      : card.correctOptionIds && card.correctOptionIds.length > 1
        ? 'multiple_choice'
        : card.options.length === 2 &&
            card.options.every((o) => /^(true|false)$/i.test(o.text.trim()))
          ? 'true_false'
          : 'single_choice';

  return {
    id: card.questionId,
    index: index + 1,
    prompt: card.prompt,
    options: card.options,
    correctOptionId: card.correctOptionId,
    ...(card.correctOptionIds ? { correctOptionIds: card.correctOptionIds } : {}),
    hasKnownAnswer: true,
    confidence: 'high',
    ...(card.explanation ? { explanation: card.explanation } : {}),
    questionType,
    answerStatus: card.answerStatus ?? 'user_confirmed',
    verificationLevel: card.verificationLevel ?? 4,
    ...(card.subjectTopic ? { subjectTopic: card.subjectTopic } : {}),
  };
}

export function FlashcardsView({ questions, onExit, onPractice }: FlashcardsViewProps) {
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState(false);
  const [deckMode, setDeckMode] = useState(false);
  const [deckIndex, setDeckIndex] = useState(0);
  const { success, info } = useToast();

  useEffect(() => {
    setCards(loadFlashcards());
  }, []);

  const due = useMemo(() => dueFlashcards(cards), [cards]);
  const stats = useMemo(() => flashcardStats(cards), [cards]);
  const visible = showAll ? cards : due;

  function persist(next: FlashcardItem[]) {
    setCards(next);
    saveFlashcards(next);
  }

  function handleCreate() {
    if (!questions || questions.length === 0) {
      info('Load an exam first to create flashcards.');
      return;
    }
    const incoming = createFlashcardsFromQuestions(questions);
    const merged = mergeFlashcards(cards, incoming);
    persist(merged);
    success(
      `${incoming.length} card(s) prepared from active exam; ${merged.length - cards.length} new card(s) added.`,
    );
  }

  const handleGrade = useCallback(
    (card: FlashcardItem, grade: FlashcardGrade) => {
      const updated = reviewFlashcard(card, grade);
      persist(cards.map((item) => (item.id === card.id ? updated : item)));
      setRevealed((prev) => ({ ...prev, [card.id]: false }));
      const msg =
        grade === 'again'
          ? 'Card marked for review tomorrow.'
          : `Scheduled for ${updated.dueDate} (${updated.interval} day interval).`;
      success(msg);

      if (deckMode && deckIndex < visible.length - 1) {
        setDeckIndex((i) => i + 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cards, deckIndex, deckMode, visible.length],
  );

  function startPractice() {
    if (!onPractice || due.length === 0) return;
    onPractice(due.map(cardToQuestion));
  }

  // Keyboard shortcut listener for active deck review
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!deckMode) return;
      const currentCard = visible[deckIndex];
      if (!currentCard) return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setRevealed((prev) => ({ ...prev, [currentCard.id]: !prev[currentCard.id] }));
      } else if (e.key === '1' && revealed[currentCard.id]) {
        handleGrade(currentCard, 'again');
      } else if (e.key === '2' && revealed[currentCard.id]) {
        handleGrade(currentCard, 'hard');
      } else if (e.key === '3' && revealed[currentCard.id]) {
        handleGrade(currentCard, 'good');
      } else if (e.key === '4' && revealed[currentCard.id]) {
        handleGrade(currentCard, 'easy');
      } else if (e.key === 'ArrowRight' && deckIndex < visible.length - 1) {
        setDeckIndex((i) => i + 1);
      } else if (e.key === 'ArrowLeft' && deckIndex > 0) {
        setDeckIndex((i) => i - 1);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deckMode, deckIndex, visible, revealed, handleGrade]);

  return (
    <section aria-labelledby="flashcardsTitle" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconShuffle size={22} style={{ color: 'var(--accent-text)' }} />
            <h2 id="flashcardsTitle" style={{ margin: 0, fontSize: '24px' }}>
              Spaced Repetition Flashcards
            </h2>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
            Powered by the SM-2 spaced repetition algorithm. Reinforce durable long-term memory.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn secondary" type="button" onClick={onExit}>
            Dashboard
          </button>
          <button
            className="btn secondary"
            type="button"
            onClick={handleCreate}
            disabled={!questions?.length}
          >
            <IconLayers size={15} /> Create Cards from Active Exam
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={startPractice}
            disabled={!onPractice || due.length === 0}
          >
            <IconSparkles size={15} /> Practice Due Cards ({due.length})
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="report-grid">
        <div className="report-stat">
          <span className="report-stat-value" style={{ color: 'var(--accent-text)' }}>{stats.total}</span>
          <span className="report-stat-label">Total Deck</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-value" style={{ color: stats.due > 0 ? 'var(--status-warn-text)' : 'var(--status-ok-text)' }}>
            {stats.due}
          </span>
          <span className="report-stat-label">Due Today</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-value" style={{ color: 'var(--status-ok-text)' }}>{stats.reviewed}</span>
          <span className="report-stat-label">Reviewed</span>
        </div>
        <div className="report-stat">
          <span className="report-stat-value">
            {stats.averageEase ? stats.averageEase.toFixed(2) : '2.50'}
          </span>
          <span className="report-stat-label">Avg Ease Factor</span>
        </div>
      </div>

      {/* Filter and Mode Controls */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className={`btn sm ${!showAll ? 'primary' : 'ghost'}`}
            type="button"
            onClick={() => {
              setShowAll(false);
              setDeckIndex(0);
            }}
          >
            Due Cards ({due.length})
          </button>
          <button
            className={`btn sm ${showAll ? 'primary' : 'ghost'}`}
            type="button"
            onClick={() => {
              setShowAll(true);
              setDeckIndex(0);
            }}
          >
            All Cards in Deck ({cards.length})
          </button>
        </div>

        {visible.length > 0 && (
          <button
            className={`btn sm ${deckMode ? 'primary' : 'secondary'}`}
            onClick={() => setDeckMode(!deckMode)}
          >
            {deckMode ? 'Switch to List View' : 'Single Card Study Deck Mode'}
          </button>
        )}
      </div>

      {/* Empty States */}
      {cards.length === 0 ? (
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <IconLayers size={40} style={{ color: 'var(--text-tertiary)', margin: '0 auto 12px' }} />
          <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            No Flashcards in Your Library Yet
          </strong>
          <p style={{ margin: '6px 0 16px 0', color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '480px', marginLeft: 'auto', marginRight: 'auto' }}>
            Upload an exam or worksheet, review the questions, and click &quot;Create Cards from Active Exam&quot; to build an intelligent SM-2 repetition deck.
          </p>
          {questions && questions.length > 0 && (
            <button className="btn primary" onClick={handleCreate} style={{ alignSelf: 'center' }}>
              Create {questions.length} Cards from Current Exam
            </button>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="card" style={{ padding: '36px', textAlign: 'center' }}>
          <IconCheck size={32} style={{ color: 'var(--status-ok-text)', margin: '0 auto 10px' }} />
          <strong style={{ fontSize: '17px', color: 'var(--text-primary)' }}>
            All Due Cards Completed!
          </strong>
          <p style={{ margin: '6px 0 14px 0', color: 'var(--text-secondary)', fontSize: '13.5px' }}>
            Your memory retention schedule is up to date for today.
          </p>
          <button className="btn secondary" onClick={() => setShowAll(true)} style={{ alignSelf: 'center' }}>
            Review All Deck Cards Early
          </button>
        </div>
      ) : deckMode ? (
        /* Single Card Focused Deck Mode */
        (() => {
          const card = visible[deckIndex];
          if (!card) return null;
          const isRev = revealed[card.id] ?? false;
          const correctIds = card.correctOptionIds?.length
            ? card.correctOptionIds
            : card.correctOptionId
              ? [card.correctOptionId]
              : [];

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '720px', margin: '0 auto', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                <span>Card {deckIndex + 1} of {visible.length}</span>
                <span>Keyboard: <kbd>Space</kbd> to flip, <kbd>1-4</kbd> to grade</span>
              </div>

              <div
                className="card"
                style={{
                  minHeight: '340px',
                  padding: '36px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  border: isRev ? '1px solid var(--border-strong)' : '1px solid var(--border-default)',
                  background: 'var(--bg-surface-elevated)',
                }}
                onClick={() => setRevealed((prev) => ({ ...prev, [card.id]: !isRev }))}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <span className="badge">{card.subjectTopic ?? 'General'}</span>
                    <span className="badge accent">Due: {card.dueDate}</span>
                  </div>

                  <p style={{ fontSize: '19px', lineHeight: 1.6, color: 'var(--text-primary)', fontWeight: 500 }}>
                    {card.prompt}
                  </p>

                  {isRev && (
                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {card.options.map((option) => {
                        const correct = correctIds.includes(option.id);
                        return (
                          <div
                            key={option.id}
                            className={`option-choice ${correct ? 'correct' : ''}`}
                            style={{ cursor: 'default' }}
                          >
                            <span className="option-letter">{option.label}</span>
                            <span>{option.text}</span>
                          </div>
                        );
                      })}

                      {card.explanation && (
                        <div style={{ marginTop: '12px', padding: '12px', borderRadius: 'var(--radius-md)', background: 'var(--bg-subtle)', fontSize: '13.5px', color: 'var(--text-secondary)' }}>
                          <strong>Explanation:</strong> {card.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12.5px', marginTop: '20px' }}>
                  {!isRev ? 'Click anywhere or press Space to reveal answer' : 'Grade recall below'}
                </div>
              </div>

              {/* SM-2 Recall Grading Bar */}
              {isRev && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                  <button className="btn danger" onClick={() => handleGrade(card, 'again')}>
                    1. Again (&lt;1d)
                  </button>
                  <button className="btn secondary" onClick={() => handleGrade(card, 'hard')}>
                    2. Hard (1d)
                  </button>
                  <button className="btn primary" onClick={() => handleGrade(card, 'good')}>
                    3. Good ({card.interval ? `${card.interval * 2}d` : '3d'})
                  </button>
                  <button className="btn secondary" onClick={() => handleGrade(card, 'easy')}>
                    4. Easy (7d+)
                  </button>
                </div>
              )}

              {/* Deck navigation buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  className="btn secondary sm"
                  disabled={deckIndex === 0}
                  onClick={() => setDeckIndex((i) => i - 1)}
                >
                  <IconArrowLeft size={14} /> Previous Card
                </button>
                <button
                  className="btn secondary sm"
                  disabled={deckIndex >= visible.length - 1}
                  onClick={() => setDeckIndex((i) => i + 1)}
                >
                  Next Card <IconArrowRight size={14} />
                </button>
              </div>
            </div>
          );
        })()
      ) : (
        /* List View */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {visible.map((card) => {
            const isRev = revealed[card.id] ?? false;
            const correctIds = card.correctOptionIds?.length
              ? card.correctOptionIds
              : card.correctOptionId
                ? [card.correctOptionId]
                : [];

            return (
              <article key={card.id} className="review-card">
                <div className="review-header">
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <strong>{card.subjectTopic ?? 'General'}</strong>
                    {card.answerStatus === 'ai_proposed' && (
                      <span className="badge warn">AI Proposed</span>
                    )}
                    <span className={`badge ${isFlashcardDue(card) ? 'accent' : ''}`}>
                      Due: {card.dueDate}
                    </span>
                  </div>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                    Interval: {card.interval}d • Ease: {card.easeFactor.toFixed(2)}
                  </span>
                </div>

                <p style={{ margin: 0, fontSize: '15.5px', fontWeight: 500 }}>{card.prompt}</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {card.options.map((option) => {
                    const correct = correctIds.includes(option.id);
                    return (
                      <div
                        key={option.id}
                        className={`option-choice ${isRev && correct ? 'correct' : ''}`}
                        style={{ cursor: 'default' }}
                      >
                        <span className="option-letter">{option.label}</span>
                        <span>{option.text}</span>
                      </div>
                    );
                  })}
                </div>

                {isRev && card.explanation && (
                  <div style={{ background: 'var(--bg-subtle)', padding: '10px 14px', borderRadius: 'var(--radius-md)', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <strong>Explanation:</strong> {card.explanation}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                  {!isRev ? (
                    <button
                      className="btn sm secondary"
                      type="button"
                      onClick={() => setRevealed((prev) => ({ ...prev, [card.id]: true }))}
                    >
                      Show Answer & Grade
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginRight: '4px' }}>
                        Grade Recall:
                      </span>
                      {(['again', 'hard', 'good', 'easy'] as FlashcardGrade[]).map((grade) => (
                        <button
                          key={grade}
                          className={`btn sm ${grade === 'good' ? 'primary' : grade === 'again' ? 'danger' : 'secondary'}`}
                          type="button"
                          onClick={() => handleGrade(card, grade)}
                          style={{ textTransform: 'capitalize' }}
                        >
                          {grade}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
