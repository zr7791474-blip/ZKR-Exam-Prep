'use client';

import { useEffect, useState } from 'react';
import type {
  AICapabilityStatus,
  Exam,
  ExamAttempt,
  ExamMode,
  Question,
} from '../lib/models/exam';
import {
  deleteAttempt,
  loadActiveExam,
  loadAttempts,
  saveActiveExam,
  loadFlashcards,
} from '../lib/storage/history';
import { ExamResultView } from './ExamResultView';
import { FlashcardsView } from './FlashcardsView';
import { PracticeSession } from './PracticeSession';
import { ProcessingReport } from './ProcessingReport';
import { QuestionReview } from './QuestionReview';
import { UploadZone } from './UploadZone';
import { AnalyticsView } from './AnalyticsView';
import { SettingsModal } from './SettingsModal';
import { CommandPalette } from './CommandPalette';
import {
  IconDocument,
  IconLayers,
  IconBookOpen,
  IconShuffle,
  IconSettings,
  IconSearch,
  IconHistory,
  IconSun,
  IconMoon,
  IconSparkles,
  IconCheckCircle,
  IconArrowRight,
  IconPlus,
  IconTrash,
} from './ui/icons';
import { useToast } from './ui/Toast';

const NAME_KEY = 'zkr:name';
const THEME_KEY = 'zkr:theme';

interface StartSessionOptions {
  persist?: boolean;
  title?: string;
}

function readName(fallback = ''): string {
  try {
    const v = localStorage.getItem(NAME_KEY);
    return v === null ? fallback : (JSON.parse(v) as string);
  } catch {
    return fallback;
  }
}

function readTheme(fallback: 'dark' | 'light' = 'dark'): 'dark' | 'light' {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : fallback;
  } catch {
    return fallback;
  }
}

export type ViewTab =
  | 'dashboard'
  | 'upload'
  | 'review'
  | 'practice'
  | 'results'
  | 'flashcards'
  | 'analytics';

export function Home() {
  const [name, setName] = useState('');
  const [part, setPart] = useState('Hello');
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [flashcardCount, setFlashcardCount] = useState(0);
  const [view, setView] = useState<ViewTab>('dashboard');
  const [activeExam, setActiveExam] = useState<Exam | null>(null);
  const [sessionMode, setSessionMode] = useState<ExamMode>('exam');
  const [sessionQuestions, setSessionQuestions] = useState<Question[] | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [currentAttempt, setCurrentAttempt] = useState<ExamAttempt | null>(null);
  const [aiStatus, setAiStatus] = useState<AICapabilityStatus | null>(null);

  // Modals & Panels
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const { success, info } = useToast();

  useEffect(() => {
    const h = new Date().getHours();
    setPart(h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');

    const savedName = readName();
    setName(savedName);

    const savedTheme = readTheme();
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

    setAttempts(loadAttempts());
    setFlashcardCount(loadFlashcards().length);

    const savedExam = loadActiveExam();
    if (savedExam) {
      setActiveExam(savedExam);
    }
  }, []);

  // Fetch AI & Engine status
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AICapabilityStatus | null) => {
        if (!cancelled && data) setAiStatus(data);
      })
      .catch(() => {
        // Core offline workflow works without status
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Global keyboard shortcuts (Ctrl+K for Command Palette)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore
    }
  }

  function handleSaveName(newName: string) {
    setName(newName);
    try {
      localStorage.setItem(NAME_KEY, JSON.stringify(newName));
    } catch {
      // ignore
    }
  }

  function refreshAttempts() {
    setAttempts(loadAttempts());
    setFlashcardCount(loadFlashcards().length);
  }

  function handleExamLoaded(exam: Exam) {
    setActiveExam(exam);
    saveActiveExam(exam);
    success(`Document "${exam.title}" loaded with ${exam.questions.length} questions`);
  }

  function startSession(
    mode: ExamMode,
    customQuestions?: Question[],
    options: StartSessionOptions = {},
  ) {
    const questions = customQuestions ?? activeExam?.questions ?? [];
    if (questions.length === 0) return;

    if (customQuestions && options.persist && activeExam) {
      const updatedExam = { ...activeExam, questions: customQuestions };
      setActiveExam(updatedExam);
      saveActiveExam(updatedExam);
    }

    setSessionQuestions(questions);
    setSessionTitle(options.title ?? activeExam?.title ?? 'Practice session');
    setSessionMode(mode);
    setView('practice');
  }

  function handleSessionComplete(attempt: ExamAttempt) {
    setCurrentAttempt(attempt);
    refreshAttempts();
    setView('results');
  }

  function viewAttemptDetails(attempt: ExamAttempt) {
    setCurrentAttempt(attempt);
    setIsHistoryOpen(false);
    setView('results');
  }

  function handleDeleteAttempt(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteAttempt(id);
    refreshAttempts();
    info('Attempt removed from history');
  }

  const questionsCount = activeExam?.questions.length ?? 0;
  const hasQuestions = questionsCount > 0;
  const knownAnswerCount = activeExam?.questions.filter((x) => x.hasKnownAnswer).length ?? 0;

  return (
    <div className="app-container">
      {/* Sleek Top Navigation Bar */}
      <header className="top-nav">
        {/* Brand */}
        <div
          className="brand-wrapper"
          onClick={() => setView('dashboard')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setView('dashboard')}
          aria-label="Go to Dashboard"
        >
          <div className="brand-icon">
            <IconLayers size={18} />
          </div>
          <div className="brand-text">
            <span>ZKR</span>
            <span style={{ fontWeight: 400, opacity: 0.85 }}>ExamPrep</span>
            <span className="brand-tag">Verified</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="nav-links" aria-label="Main Navigation">
          <button
            type="button"
            className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`nav-btn ${view === 'upload' ? 'active' : ''}`}
            onClick={() => setView('upload')}
          >
            Upload
          </button>
          <button
            type="button"
            className={`nav-btn ${view === 'review' ? 'active' : ''}`}
            disabled={!hasQuestions}
            onClick={() => setView('review')}
          >
            Library {hasQuestions && `(${questionsCount})`}
          </button>
          <button
            type="button"
            className={`nav-btn ${view === 'practice' ? 'active' : ''}`}
            disabled={!hasQuestions}
            onClick={() => startSession('practice')}
          >
            Practice
          </button>
          <button
            type="button"
            className={`nav-btn ${view === 'flashcards' ? 'active' : ''}`}
            onClick={() => setView('flashcards')}
          >
            Flashcards {flashcardCount > 0 && `(${flashcardCount})`}
          </button>
          <button
            type="button"
            className={`nav-btn ${view === 'analytics' ? 'active' : ''}`}
            onClick={() => setView('analytics')}
          >
            Analytics
          </button>
        </nav>

        {/* Quick Toolbar */}
        <div className="top-actions">
          {/* Global Search shortcut */}
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setIsCommandPaletteOpen(true)}
            title="Search & Jump (Ctrl+K)"
          >
            <IconSearch size={15} />
            <span style={{ display: 'none' }}>Search</span>
            <kbd style={{ fontSize: '11px', opacity: 0.7, padding: '1px 5px', borderRadius: '4px', background: 'var(--bg-subtle)', border: '1px solid var(--border-subtle)' }}>
              ⌘K
            </kbd>
          </button>

          {/* History modal */}
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => {
              refreshAttempts();
              setIsHistoryOpen(true);
            }}
            title="View Attempt History"
          >
            <IconHistory size={15} />
            <span>History ({attempts.length})</span>
          </button>

          {/* Theme Switcher */}
          <button
            type="button"
            className="btn ghost sm icon-only"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
          </button>

          {/* Settings Modal */}
          <button
            type="button"
            className="btn ghost sm icon-only"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Platform Settings"
            title="Settings & Engine Status"
          >
            <IconSettings size={16} />
          </button>

          {/* Student Profile Avatar */}
          <button
            type="button"
            className="btn avatar"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Student Profile"
            title={name ? `Signed in as ${name}` : 'Set Profile Name'}
          >
            {name ? name[0].toUpperCase() : '?'}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="main-content">
        {/* DASHBOARD VIEW */}
        {view === 'dashboard' && (
          <>
            {/* Hero Welcome */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h1 style={{ fontSize: 'clamp(26px, 3.5vw, 36px)', margin: 0 }}>
                {name ? `${part}, ${name}` : part}
              </h1>
              <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '15px' }}>
                Transform educational documents into precision exam drills with verified scoring and spaced repetition.
              </p>
            </div>

            {/* Active Document / Resume Card */}
            {hasQuestions && activeExam ? (
              <div
                className="card"
                style={{
                  padding: '24px',
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, var(--bg-surface) 60%)',
                  borderColor: 'rgba(99, 102, 241, 0.3)',
                }}
              >
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span className="badge ok">Active Document</span>
                      {activeExam.documentKind && (
                        <span className="badge">{activeExam.documentKind.replace('_', ' ')}</span>
                      )}
                    </div>
                    <strong style={{ fontSize: '19px', color: 'var(--text-primary)' }}>
                      {activeExam.title}
                    </strong>
                    <div style={{ fontSize: '13.5px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {questionsCount} questions ready • {knownAnswerCount} with verified source answers
                      {activeExam.totalPages ? ` • ${activeExam.totalPages} page(s)` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className="btn secondary" type="button" onClick={() => setView('review')}>
                      <IconBookOpen size={15} /> Review Library
                    </button>
                    <button className="btn secondary" type="button" onClick={() => startSession('shuffle')}>
                      <IconShuffle size={15} /> Shuffle Drill
                    </button>
                    <button className="btn primary" type="button" onClick={() => startSession('exam')}>
                      <IconArrowRight size={15} /> Start Exam ({questionsCount} Qs)
                    </button>
                  </div>
                </div>

                {activeExam.processingReport && (
                  <div style={{ marginTop: '16px' }}>
                    <ProcessingReport report={activeExam.processingReport} compact />
                  </div>
                )}
              </div>
            ) : (
              /* No document loaded CTA */
              <div
                className="card"
                style={{
                  padding: '32px 24px',
                  textAlign: 'center',
                  background: 'var(--bg-surface)',
                  border: '1px dashed var(--border-strong)',
                }}
              >
                <div className="drop-icon-wrap" style={{ margin: '0 auto 12px' }}>
                  <IconDocument size={28} />
                </div>
                <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
                  No active document loaded
                </strong>
                <p style={{ margin: '6px 0 16px', color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '440px', marginLeft: 'auto', marginRight: 'auto' }}>
                  Upload an exam paper, worksheet, or study notes as a PDF or image to extract questions and begin verified practice.
                </p>
                <button
                  className="btn primary lg"
                  type="button"
                  onClick={() => setView('upload')}
                  style={{ alignSelf: 'center' }}
                >
                  <IconPlus size={16} /> Upload Exam Document
                </button>
              </div>
            )}

            {/* Quick Action Cards */}
            <div className="cards">
              <article className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-text)' }}>
                  <IconBookOpen size={20} />
                  <h2 style={{ fontSize: '17px' }}>Simulated Exam</h2>
                </div>
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0 }}>
                  Formal timed test environment. Questions and verified keys are scored objectively; uncertain answers are flagged separately.
                </p>
                <button
                  className="btn primary sm"
                  disabled={!hasQuestions}
                  onClick={() => startSession('exam')}
                  style={{ marginTop: 'auto' }}
                >
                  Start Exam {hasQuestions && `(${questionsCount} Qs)`}
                </button>
              </article>

              <article className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-ok-text)' }}>
                  <IconCheckCircle size={20} />
                  <h2 style={{ fontSize: '17px' }}>Interactive Practice</h2>
                </div>
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0 }}>
                  Learn at your own rhythm with instant feedback, explanations, step-by-step reasoning, and challenge tools.
                </p>
                <button
                  className="btn secondary sm"
                  disabled={!hasQuestions}
                  onClick={() => startSession('practice')}
                  style={{ marginTop: 'auto' }}
                >
                  Start Practice {hasQuestions && `(${questionsCount} Qs)`}
                </button>
              </article>

              <article className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-purple-text)' }}>
                  <IconShuffle size={20} />
                  <h2 style={{ fontSize: '17px' }}>Shuffle Exercises</h2>
                </div>
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0 }}>
                  Randomize question order and answer choices while mathematically preserving correct answer mappings to prevent rote memorization.
                </p>
                <button
                  className="btn secondary sm"
                  disabled={!hasQuestions}
                  onClick={() => startSession('shuffle')}
                  style={{ marginTop: 'auto' }}
                >
                  Start Shuffle {hasQuestions && `(${questionsCount} Qs)`}
                </button>
              </article>

              <article className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-info-text)' }}>
                  <IconLayers size={20} />
                  <h2 style={{ fontSize: '17px' }}>Spaced Repetition</h2>
                </div>
                <p style={{ fontSize: '13.5px', color: 'var(--text-secondary)', margin: 0 }}>
                  Review reliably answered questions with SM-2 interval scheduling to ensure permanent memory retention before your test.
                </p>
                <button
                  className="btn secondary sm"
                  type="button"
                  onClick={() => setView('flashcards')}
                  style={{ marginTop: 'auto' }}
                >
                  Open Flashcards ({flashcardCount})
                </button>
              </article>
            </div>

            {/* System Engine Status Card */}
            <div className="card" style={{ padding: '16px 20px', background: 'var(--bg-subtle)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`badge ${aiStatus?.configured ? 'ok' : 'warn'}`}>
                    <IconSparkles size={13} />
                    {aiStatus
                      ? aiStatus.configured
                        ? `AI Ready: ${aiStatus.provider}/${aiStatus.model}`
                        : 'AI Offline (Credentials not set)'
                      : 'Checking AI status…'}
                  </span>
                  <span className={`badge ${aiStatus?.capabilities.ocr ? 'ok' : 'warn'}`}>
                    Tesseract OCR {aiStatus?.capabilities.ocr ? 'Ready' : 'Unavailable'}
                  </span>
                  {aiStatus?.configured && !aiStatus.verifierConfigured && (
                    <span className="badge warn">Verifier: Arithmetic & Proposals</span>
                  )}
                </div>

                <button className="btn ghost sm" onClick={() => setIsSettingsOpen(true)}>
                  Configure Engine <IconArrowRight size={13} />
                </button>
              </div>
            </div>

            {/* Recent Sessions Table */}
            {attempts.length > 0 && (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '17px' }}>Recent Practice Sessions</h3>
                  <button className="btn ghost sm" onClick={() => setView('analytics')}>
                    View Full Analytics <IconArrowRight size={13} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {attempts.slice(0, 4).map((a) => (
                    <div
                      key={a.id}
                      onClick={() => viewAttemptDetails(a)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '14.5px' }}>{a.examTitle}</strong>
                        <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          Mode: <span style={{ textTransform: 'capitalize' }}>{a.mode}</span> • Completed{' '}
                          {new Date(a.completedAt).toLocaleDateString()}
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {a.scorePercentage !== null ? (
                          <span
                            className={`badge ${
                              a.scorePercentage >= 80 ? 'ok' : a.scorePercentage >= 60 ? 'warn' : 'err'
                            }`}
                          >
                            Score: {a.scorePercentage}%
                          </span>
                        ) : (
                          <span className="badge">{a.answeredCount} answered</span>
                        )}
                        <IconArrowRight size={14} style={{ color: 'var(--text-tertiary)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* UPLOAD VIEW */}
        {view === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '24px' }}>Upload Educational Document</h2>
                <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)' }}>
                  Extract questions, mathematical expressions, options, and official answer keys.
                </p>
              </div>
              <button className="btn secondary" onClick={() => setView('dashboard')}>
                Back to Dashboard
              </button>
            </div>

            <UploadZone
              onExamLoaded={handleExamLoaded}
              onNavigateToReview={() => setView('review')}
            />
          </div>
        )}

        {/* QUESTION REVIEW VIEW */}
        {view === 'review' && activeExam && (
          <QuestionReview
            initialQuestions={activeExam.questions}
            examTitle={activeExam.title}
            onStartExam={(qs) => startSession('exam', qs, { persist: true })}
            onStartPractice={(qs) => startSession('practice', qs, { persist: true })}
            onStartShuffle={(qs) => startSession('shuffle', qs, { persist: true })}
            onCancel={() => setView('dashboard')}
            aiStatus={aiStatus}
            processingReport={activeExam.processingReport}
          />
        )}

        {/* PRACTICE & EXAM SESSION VIEW */}
        {view === 'practice' && (sessionQuestions || activeExam) && (
          <PracticeSession
            initialQuestions={sessionQuestions ?? activeExam?.questions ?? []}
            examTitle={sessionTitle || activeExam?.title || 'Practice session'}
            mode={sessionMode}
            onComplete={handleSessionComplete}
            onExit={() => setView('dashboard')}
            aiStatus={aiStatus}
          />
        )}

        {/* RESULTS & MASTERY VIEW */}
        {view === 'results' && currentAttempt && (
          <ExamResultView
            attempt={currentAttempt}
            onRetake={(mode) =>
              startSession(mode, currentAttempt.questionsSnapshot, {
                title: currentAttempt.examTitle,
              })
            }
            onReviewQuestions={() => setView('review')}
            onExit={() => setView('dashboard')}
            onPracticeQuestions={(qs) =>
              startSession('practice', qs, { title: currentAttempt.examTitle })
            }
            onOpenFlashcards={() => setView('flashcards')}
          />
        )}

        {/* FLASHCARDS VIEW */}
        {view === 'flashcards' && (
          <FlashcardsView
            questions={activeExam?.questions}
            onExit={() => setView('dashboard')}
            onPractice={(qs) =>
              startSession('practice', qs, { title: 'Spaced repetition practice' })
            }
          />
        )}

        {/* ANALYTICS VIEW */}
        {view === 'analytics' && (
          <AnalyticsView
            attempts={attempts}
            onSelectAttempt={viewAttemptDetails}
            onPracticeQuestions={(qs) =>
              startSession('practice', qs, { title: 'Targeted Revision Practice' })
            }
            onExit={() => setView('dashboard')}
          />
        )}
      </main>

      {/* History Modal / Drawer */}
      {isHistoryOpen && (
        <div className="modal-overlay" onClick={() => setIsHistoryOpen(false)} role="dialog" aria-modal="true">
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <IconHistory size={20} style={{ color: 'var(--accent-text)' }} />
                <h3 style={{ margin: 0, fontSize: '18px' }}>Practice History ({attempts.length})</h3>
              </div>
              <button className="btn ghost sm icon-only" onClick={() => setIsHistoryOpen(false)}>
                ✕
              </button>
            </div>

            {attempts.length === 0 ? (
              <div style={{ padding: '36px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                No completed attempts yet. Take an exam simulation or practice session to track your progress.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '420px', overflowY: 'auto' }}>
                {attempts.map((a) => (
                  <div
                    key={a.id}
                    onClick={() => viewAttemptDetails(a)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '14.5px' }}>{a.examTitle}</strong>
                      <div style={{ fontSize: '12.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                        {a.scorePercentage !== null
                          ? `Score: ${a.scorePercentage}% (${a.correctCount}/${a.knownAnswerQuestions})`
                          : `${a.answeredCount} answered (unkeyed)`}{' '}
                        • <span style={{ textTransform: 'capitalize' }}>{a.mode}</span> •{' '}
                        {new Date(a.completedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        className="btn ghost sm icon-only danger"
                        type="button"
                        onClick={(e) => handleDeleteAttempt(e, a.id)}
                        aria-label="Delete attempt"
                        title="Delete attempt"
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
              <button className="btn secondary" onClick={() => setIsHistoryOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        attempts={attempts}
        onSelectAttempt={viewAttemptDetails}
        onNavigate={(targetView) => setView(targetView)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Settings & System Engine Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        aiStatus={aiStatus}
        name={name}
        onSaveName={handleSaveName}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    </div>
  );
}
