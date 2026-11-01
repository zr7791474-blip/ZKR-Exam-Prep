import { beforeEach, describe, expect, it } from 'vitest';
import type { ExamAttempt } from '../models/exam';
import {
  ATTEMPTS_STORAGE_KEY,
  deleteAttempt,
  getAttemptById,
  LEGACY_ATTEMPTS_KEY,
  loadActiveExam,
  loadAttempts,
  saveActiveExam,
  saveAttempt,
} from './history';

class MockStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

describe('Storage and History Persistence', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  const sampleAttempt: ExamAttempt = {
    id: 'attempt-1',
    examId: 'exam-1',
    examTitle: 'Biology 101',
    startedAt: '2026-10-30T09:00:00.000Z',
    completedAt: '2026-10-30T09:15:00.000Z',
    mode: 'exam',
    answers: { 'q-1': 'opt-1' },
    totalQuestions: 1,
    knownAnswerQuestions: 1,
    unknownAnswerQuestions: 0,
    answeredCount: 1,
    correctCount: 1,
    incorrectCount: 0,
    scorePercentage: 100,
    questionsSnapshot: [
      {
        id: 'q-1',
        index: 1,
        prompt: 'Cell powerhouse?',
        options: [{ id: 'opt-1', label: 'A', text: 'Mitochondria', isCorrect: true }],
        correctOptionId: 'opt-1',
        hasKnownAnswer: true,
        confidence: 'high',
        answerStatus: 'official_answer',
        verificationLevel: 1,
      },
    ],
  };

  it('saves and loads attempts correctly', () => {
    expect(loadAttempts(mockStorage)).toEqual([]);

    const ok = saveAttempt(sampleAttempt, mockStorage);
    expect(ok).toBe(true);

    const loaded = loadAttempts(mockStorage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('attempt-1');
    expect(loaded[0].scorePercentage).toBe(100);
  });

  it('handles completely corrupted JSON without crashing', () => {
    mockStorage.setItem(ATTEMPTS_STORAGE_KEY, '{invalid json here ...');
    const loaded = loadAttempts(mockStorage);
    expect(loaded).toEqual([]);
  });

  it('filters out corrupted or partial objects in the attempts array', () => {
    const mixed = [
      sampleAttempt,
      { title: 'broken' }, // missing id, questionsSnapshot, etc.
      null,
      'just a string',
    ];
    mockStorage.setItem(ATTEMPTS_STORAGE_KEY, JSON.stringify(mixed));

    const loaded = loadAttempts(mockStorage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('attempt-1');
  });

  it('safely migrates legacy attempts when modern key is missing', () => {
    const legacy = [
      { title: 'Legacy Midterm', score: '85%', at: '2026-10-25T10:00:00.000Z' },
    ];
    mockStorage.setItem(LEGACY_ATTEMPTS_KEY, JSON.stringify(legacy));

    const loaded = loadAttempts(mockStorage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].examTitle).toBe('Legacy Midterm');
  });

  it('finds and deletes attempts by ID', () => {
    saveAttempt(sampleAttempt, mockStorage);

    const found = getAttemptById('attempt-1', mockStorage);
    expect(found?.examTitle).toBe('Biology 101');

    const notFound = getAttemptById('non-existent', mockStorage);
    expect(notFound).toBeNull();

    const deleted = deleteAttempt('attempt-1', mockStorage);
    expect(deleted).toBe(true);
    expect(loadAttempts(mockStorage)).toHaveLength(0);
  });

  it('saves and loads active exam safely', () => {
    const exam = {
      id: 'exam-active',
      title: 'Active Midterm',
      sourceFileName: 'midterm.pdf',
      uploadedAt: '2026-10-30T09:00:00Z',
      questions: [],
    };

    saveActiveExam(exam, mockStorage);
    const loaded = loadActiveExam(mockStorage);
    expect(loaded?.title).toBe('Active Midterm');
  });
});
