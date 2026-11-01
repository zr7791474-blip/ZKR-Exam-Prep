import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAICache } from './cache';
import { resetProviderCache, setProviderForTests, type ProviderClient } from './provider';

import { GET as statusGET } from '../../app/api/ai/status/route';
import { POST as solvePOST } from '../../app/api/ai/solve/route';
import { POST as explainPOST } from '../../app/api/ai/explain/route';
import { POST as challengePOST } from '../../app/api/ai/challenge/route';
import { POST as similarPOST } from '../../app/api/ai/similar/route';
import { resetRateLimits } from '../security/rate-limit';
import { LIMITS } from '../security/limits';

const QUESTION = {
  id: 'q1',
  index: 1,
  prompt: 'Which city is the capital of France?',
  options: [
    { id: 'a', label: 'A', text: 'London' },
    { id: 'b', label: 'B', text: 'Paris' },
    { id: 'c', label: 'C', text: 'Berlin' },
  ],
};

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockProvider(
  payload: unknown,
  options: { name?: string; model?: string } = {},
): ProviderClient {
  return {
    name: options.name ?? 'mock',
    model: options.model ?? 'mock-model',
    chat: vi.fn(async () =>
      typeof payload === 'string' ? payload : JSON.stringify(payload),
    ),
  };
}

const solution = {
  answer: 'B',
  explanation: 'Paris is the capital of France.',
  confidence: 'high',
  optionAnalysis: [],
};

beforeEach(() => {
  resetRateLimits();
  resetProviderCache();
  clearAICache();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetProviderCache();
});

describe('GET /api/ai/status', () => {
  it('reports honestly when no provider is configured', async () => {
    vi.stubEnv('AI_PROVIDER', '');
    vi.stubEnv('AI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('AI_VERIFIER_MODEL', '');

    const response = await statusGET(new Request('http://localhost/api/ai/status'));
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.configured).toBe(false);
    expect(body.provider).toBe('none');
    expect(body.capabilities.solve).toBe(false);
    expect(body.capabilities.independentVerification).toBe(false);
    expect(body.message).toContain('Extraction');
    expect(JSON.stringify(body)).not.toMatch(/sk-[a-z0-9]/i);
  });

  it('reports a configured mock provider without exposing a key', async () => {
    vi.stubEnv('AI_PROVIDER', 'mock');
    vi.stubEnv('AI_MODEL', 'mock-model');

    const response = await statusGET(new Request('http://localhost/api/ai/status'));
    const body = await response.json();

    expect(body.configured).toBe(true);
    expect(body.provider).toBe('mock');
    expect(body.model).toBe('mock-model');
    expect(body.capabilities.solve).toBe(true);
    expect(body).not.toHaveProperty('apiKey');
  });
});

describe('POST /api/ai/solve', () => {
  it('returns 503 when AI is not configured', async () => {
    vi.stubEnv('AI_PROVIDER', '');
    vi.stubEnv('AI_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');

    const response = await solvePOST(
      jsonRequest('http://localhost/api/ai/solve', { questions: [QUESTION] }),
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('rejects malformed JSON and invalid requests', async () => {
    setProviderForTests(mockProvider(solution), null);

    const badJson = await solvePOST(
      new Request('http://localhost/api/ai/solve', { method: 'POST', body: 'not-json' }),
    );
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error.code).toBe('INVALID_BODY');

    const invalid = await solvePOST(
      jsonRequest('http://localhost/api/ai/solve', { questions: [] }),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe('INVALID_REQUEST');
  });

  it('solves a question and keeps the answer as an AI proposal', async () => {
    setProviderForTests(mockProvider(solution), null);

    const response = await solvePOST(
      jsonRequest('http://localhost/api/ai/solve', { questions: [QUESTION] }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.provider).toBe('mock');
    expect(body.model).toBe('mock-model');
    expect(body.verifierConfigured).toBe(false);
    expect(body.solvedCount).toBe(1);
    expect(body.questions[0].answerStatus).toBe('ai_proposed');
    expect(body.questions[0].verificationLevel).toBe(2);
    expect(body.questions[0].hasKnownAnswer).toBe(false);
    expect(body.verificationNote).toContain('excluded from objective scores');
  });

  it('ignores a client claim that an answer is already AI-verified', async () => {
    setProviderForTests(mockProvider(solution), null);

    const response = await solvePOST(
      jsonRequest('http://localhost/api/ai/solve', {
        questions: [
          {
            ...QUESTION,
            answerStatus: 'ai_verified',
            verificationLevel: 3,
          },
        ],
      }),
    );
    const body = await response.json();

    expect(body.questions[0].answerStatus).toBe('ai_proposed');
    expect(body.questions[0].verificationLevel).toBe(2);
  });

  it('preserves an official answer and marks a disagreement as disputed', async () => {
    setProviderForTests(mockProvider(solution), null);

    const response = await solvePOST(
      jsonRequest('http://localhost/api/ai/solve', {
        questions: [
          {
            ...QUESTION,
            answerStatus: 'official_answer',
            hasKnownAnswer: true,
            correctOptionId: 'a',
            officialCorrectOptionId: 'a',
            officialAnswerLabel: 'A',
          },
        ],
        checkOfficialAnswers: true,
      }),
    );
    const body = await response.json();

    expect(body.questions[0].answerStatus).toBe('disputed');
    expect(body.questions[0].correctOptionId).toBe('a');
    expect(body.questions[0].disputeExplanation).toContain('Official source answer: A');
    expect(body.disputedCount).toBe(1);
  });

  it('rate limits repeated solve requests', async () => {
    setProviderForTests(mockProvider(solution), null);
    const url = 'http://localhost/api/ai/solve';

    for (let i = 0; i < LIMITS.aiSolve.limit; i++) {
      const response = await solvePOST(
        new Request(url, { method: 'POST', headers: { 'x-real-ip': '10.0.0.9' }, body: '{}' }),
      );
      expect(response.status).toBe(400);
    }

    const blocked = await solvePOST(
      new Request(url, { method: 'POST', headers: { 'x-real-ip': '10.0.0.9' }, body: '{}' }),
    );
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/ai/explain', () => {
  it('returns a validated explanation', async () => {
    setProviderForTests(
      mockProvider({
        explanation: 'Think of it as a simpler comparison.',
        keyPoints: ['Compare the options'],
        confidence: 'high',
      }),
      null,
    );

    const response = await explainPOST(
      jsonRequest('http://localhost/api/ai/explain', { question: QUESTION, mode: 'simpler' }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.explanation).toContain('simpler comparison');
    expect(body.keyPoints).toEqual(['Compare the options']);
    expect(body.provider).toBe('mock');
  });

  it('rejects an invalid request', async () => {
    const response = await explainPOST(
      jsonRequest('http://localhost/api/ai/explain', { question: { id: 'x' } }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_REQUEST');
  });

  it('returns a safe error when the provider output is malformed', async () => {
    setProviderForTests(mockProvider('{"unexpected": true}'), null);

    const response = await explainPOST(
      jsonRequest('http://localhost/api/ai/explain', { question: QUESTION }),
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe('INVALID_RESPONSE');
  });
});

describe('POST /api/ai/challenge', () => {
  it('returns a validated challenge result', async () => {
    setProviderForTests(mockProvider({ ...solution, changed: true }), null);

    const response = await challengePOST(
      jsonRequest('http://localhost/api/ai/challenge', {
        question: QUESTION,
        currentAnswerLabel: 'A',
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.labels).toEqual(['B']);
    expect(body.changed).toBe(true);
    expect(body.solution.answer).toBe('B');
  });

  it('rejects an answer label that does not exist', async () => {
    setProviderForTests(mockProvider({ ...solution, answer: 'Z' }), null);

    const response = await challengePOST(
      jsonRequest('http://localhost/api/ai/challenge', { question: QUESTION }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('INVALID_RESPONSE');
  });
});

describe('POST /api/ai/similar', () => {
  it('returns generated practice questions marked as AI-generated', async () => {
    setProviderForTests(
      mockProvider({
        questions: [
          {
            prompt: 'Which city is the capital of Spain?',
            options: [
              { label: 'A', text: 'Madrid' },
              { label: 'B', text: 'Barcelona' },
            ],
            correctLabel: 'A',
            explanation: 'Madrid is the capital of Spain.',
          },
        ],
      }),
      null,
    );

    const response = await similarPOST(
      jsonRequest('http://localhost/api/ai/similar', { question: QUESTION, count: 1 }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.questions).toHaveLength(1);
    expect(body.questions[0].isAiGenerated).toBe(true);
    expect(body.questions[0].generation).toBe('ai');
    expect(body.questions[0].answerStatus).toBe('ai_proposed');
    expect(body.questions[0].options[0].isCorrect).toBe(true);
    expect(body.questions[0].correctOptionId).toBe(body.questions[0].options[0].id);
  });

  it('rejects malformed generated questions', async () => {
    setProviderForTests(mockProvider({ questions: [] }), null);

    const response = await similarPOST(
      jsonRequest('http://localhost/api/ai/similar', { question: QUESTION }),
    );
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe('INVALID_RESPONSE');
  });
});
