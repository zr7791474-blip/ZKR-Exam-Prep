'use client';

import React, { useMemo } from 'react';
import type { ExamAttempt, Question } from '@/lib/models/exam';
import {
  IconBarChart,
  IconCheckCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconSparkles,
} from './ui/icons';

interface AnalyticsViewProps {
  attempts: ExamAttempt[];
  onSelectAttempt: (attempt: ExamAttempt) => void;
  onPracticeQuestions?: (questions: Question[]) => void;
  onExit: () => void;
}

export function AnalyticsView({
  attempts,
  onSelectAttempt,
  onPracticeQuestions,
  onExit,
}: AnalyticsViewProps) {
  // Aggregate statistics
  const stats = useMemo(() => {
    if (attempts.length === 0) {
      return {
        totalAttempts: 0,
        scoredAttempts: 0,
        averageScore: null as number | null,
        totalQuestionsAnswered: 0,
        totalCorrect: 0,
        weakTopics: [] as { topic: string; total: number; incorrect: number; accuracy: number }[],
        strongTopics: [] as { topic: string; total: number; correct: number; accuracy: number }[],
      };
    }

    let totalScoreSum = 0;
    let scoredCount = 0;
    let totalQuestions = 0;
    let totalCorrect = 0;

    const topicStats: Record<string, { total: number; incorrect: number; correct: number }> = {};

    attempts.forEach((a) => {
      totalQuestions += a.answeredCount;
      totalCorrect += a.correctCount;
      if (typeof a.scorePercentage === 'number') {
        totalScoreSum += a.scorePercentage;
        scoredCount++;
      }

      // Aggregate weak topics
      if (a.weakTopics && a.weakTopics.length > 0) {
        a.weakTopics.forEach((wt) => {
          if (!topicStats[wt.topic]) {
            topicStats[wt.topic] = { total: 0, incorrect: 0, correct: 0 };
          }
          topicStats[wt.topic].total += wt.totalCount;
          topicStats[wt.topic].incorrect += wt.incorrectCount;
          topicStats[wt.topic].correct += wt.totalCount - wt.incorrectCount;
        });
      }
    });

    const topicList = Object.entries(topicStats).map(([topic, data]) => ({
      topic,
      total: data.total,
      incorrect: data.incorrect,
      correct: data.correct,
      accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
    }));

    const weakTopics = [...topicList]
      .filter((t) => t.accuracy < 70)
      .sort((a, b) => a.accuracy - b.accuracy);

    const strongTopics = [...topicList]
      .filter((t) => t.accuracy >= 70)
      .sort((a, b) => b.accuracy - a.accuracy);

    return {
      totalAttempts: attempts.length,
      scoredAttempts: scoredCount,
      averageScore: scoredCount > 0 ? Math.round(totalScoreSum / scoredCount) : null,
      totalQuestionsAnswered: totalQuestions,
      totalCorrect,
      weakTopics,
      strongTopics,
    };
  }, [attempts]);

  return (
    <section aria-labelledby="analyticsTitle" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconBarChart size={24} style={{ color: 'var(--accent-text)' }} />
            <h2 id="analyticsTitle" style={{ margin: 0, fontSize: '24px' }}>
              Learning Analytics & Mastery
            </h2>
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
            Empirical insights based exclusively on your verified answer keys and completed practice sessions.
          </p>
        </div>
        <button className="btn secondary" onClick={onExit}>
          Back to Dashboard
        </button>
      </div>

      {/* Top Stat Grid */}
      <div className="report-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="report-stat" style={{ padding: '16px' }}>
          <span className="report-stat-value" style={{ fontSize: '26px', color: 'var(--accent-text)' }}>
            {stats.averageScore !== null ? `${stats.averageScore}%` : '—'}
          </span>
          <span className="report-stat-label">Average Reliable Score</span>
        </div>

        <div className="report-stat" style={{ padding: '16px' }}>
          <span className="report-stat-value" style={{ fontSize: '26px' }}>
            {stats.totalAttempts}
          </span>
          <span className="report-stat-label">Sessions Completed</span>
        </div>

        <div className="report-stat" style={{ padding: '16px' }}>
          <span className="report-stat-value" style={{ fontSize: '26px' }}>
            {stats.totalQuestionsAnswered}
          </span>
          <span className="report-stat-label">Questions Answered</span>
        </div>

        <div className="report-stat" style={{ padding: '16px' }}>
          <span className="report-stat-value" style={{ fontSize: '26px', color: 'var(--status-ok-text)' }}>
            {stats.totalCorrect}
          </span>
          <span className="report-stat-label">Correct Answers</span>
        </div>
      </div>

      {/* Topics Breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Needs Improvement */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-warn-text)' }}>
            <IconAlertTriangle size={18} />
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
              Topics Needing Revision ({stats.weakTopics.length})
            </h3>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            Topics where your accuracy is below 70%. Focus your practice here.
          </p>

          {stats.weakTopics.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13.5px' }}>
              No critical weak topics detected. Great work!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
              {stats.weakTopics.map((t) => (
                <div key={t.topic} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ fontWeight: 600 }}>{t.topic}</span>
                    <span style={{ color: 'var(--status-warn-text)', fontWeight: 600 }}>
                      {t.accuracy}% ({t.incorrect} mistakes)
                    </span>
                  </div>
                  <div style={{ height: '7px', borderRadius: '4px', background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${t.accuracy}%`,
                        background: 'linear-gradient(90deg, var(--status-err), var(--status-warn))',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                </div>
              ))}

              {onPracticeQuestions && (
                <button
                  className="btn primary sm"
                  style={{ marginTop: '8px', alignSelf: 'flex-start' }}
                  onClick={() => {
                    // Extract questions from attempts for weak topics
                    const weakNames = new Set(stats.weakTopics.map((w) => w.topic));
                    const collected: Question[] = [];
                    const seen = new Set<string>();
                    for (const a of attempts) {
                      for (const q of a.questionsSnapshot) {
                        if (q.subjectTopic && weakNames.has(q.subjectTopic) && !seen.has(q.id)) {
                          seen.add(q.id);
                          collected.push(q);
                        }
                      }
                    }
                    if (collected.length > 0) {
                      onPracticeQuestions(collected);
                    }
                  }}
                >
                  <IconSparkles size={14} /> Practice Weak Topics Drill
                </button>
              )}
            </div>
          )}
        </div>

        {/* Strong Topics */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--status-ok-text)' }}>
            <IconCheckCircle size={18} />
            <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
              Strong Mastery Topics ({stats.strongTopics.length})
            </h3>
          </div>
          <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
            Subjects where you have achieved 70%+ reliable accuracy.
          </p>

          {stats.strongTopics.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13.5px' }}>
              Complete more exam sessions to establish mastery baselines.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
              {stats.strongTopics.map((t) => (
                <div key={t.topic} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                    <span style={{ fontWeight: 600 }}>{t.topic}</span>
                    <span style={{ color: 'var(--status-ok-text)', fontWeight: 600 }}>
                      {t.accuracy}% ({t.correct}/{t.total})
                    </span>
                  </div>
                  <div style={{ height: '7px', borderRadius: '4px', background: 'var(--bg-subtle)', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        width: `${t.accuracy}%`,
                        background: 'var(--status-ok)',
                        borderRadius: '4px',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Attempt History Table */}
      <div className="card">
        <h3 style={{ margin: 0, fontSize: '17px' }}>Session History & Score Progression</h3>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', margin: 0 }}>
          Click any session to view its full breakdown, mistake review, and revision sets.
        </p>

        {attempts.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No sessions completed yet. Practice an exam or flashcard deck to begin tracking progress.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table className="report-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ padding: '10px 12px' }}>Exam Title</th>
                  <th style={{ padding: '10px 12px' }}>Mode</th>
                  <th style={{ padding: '10px 12px' }}>Reliable Score</th>
                  <th style={{ padding: '10px 12px' }}>Answered</th>
                  <th style={{ padding: '10px 12px' }}>Date</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => onSelectAttempt(a)}
                    style={{ cursor: 'pointer', transition: 'background 0.15s ease' }}
                  >
                    <td style={{ padding: '12px', fontWeight: 600 }}>{a.examTitle}</td>
                    <td style={{ padding: '12px' }}>
                      <span className="badge" style={{ textTransform: 'capitalize' }}>
                        {a.mode}
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {a.scorePercentage !== null ? (
                        <span
                          className={`badge ${
                            a.scorePercentage >= 80
                              ? 'ok'
                              : a.scorePercentage >= 60
                                ? 'warn'
                                : 'err'
                          }`}
                        >
                          {a.scorePercentage}% ({a.correctCount}/{a.knownAnswerQuestions})
                        </span>
                      ) : (
                        <span className="badge">Unkeyed</span>
                      )}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                      {a.answeredCount} / {a.totalQuestions}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      {new Date(a.completedAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      <button
                        className="btn sm ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectAttempt(a);
                        }}
                      >
                        View Report <IconArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
