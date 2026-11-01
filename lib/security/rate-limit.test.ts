import { beforeEach, describe, expect, it } from 'vitest';
import { aiStatusForError, enforceRateLimit, LIMITS } from './limits';
import { clientKey, rateLimit, resetRateLimits } from './rate-limit';

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { headers });
}

beforeEach(() => {
  resetRateLimits();
});

describe('rateLimit', () => {
  it('allows requests up to the limit and reports remaining budget', () => {
    const options = { limit: 2, windowMs: 1000 };
    expect(rateLimit('key', options, 0)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(rateLimit('key', options, 100).allowed).toBe(true);
    expect(rateLimit('key', options, 200)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('reports a retry delay based on the oldest hit in the window', () => {
    const options = { limit: 1, windowMs: 10_000 };
    rateLimit('key', options, 1000);
    const blocked = rateLimit('key', options, 4000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(7);
  });

  it('frees the window once hits expire', () => {
    const options = { limit: 1, windowMs: 1000 };
    rateLimit('key', options, 0);
    expect(rateLimit('key', options, 500).allowed).toBe(false);
    expect(rateLimit('key', options, 1500).allowed).toBe(true);
  });

  it('isolates separate keys', () => {
    const options = { limit: 1, windowMs: 1000 };
    rateLimit('a', options, 0);
    expect(rateLimit('b', options, 0).allowed).toBe(true);
  });
});

describe('clientKey', () => {
  it('uses the first forwarded address', () => {
    expect(clientKey(request({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }), 'ai')).toBe(
      'ai:203.0.113.5',
    );
  });

  it('falls back to x-real-ip and then unknown', () => {
    expect(clientKey(request({ 'x-real-ip': '198.51.100.7' }), 'ai')).toBe('ai:198.51.100.7');
    expect(clientKey(request(), 'ai')).toBe('ai:unknown');
  });
});

describe('enforceRateLimit', () => {
  it('returns a 429 response with retry-after once the budget is exhausted', () => {
    const now = 1000;
    for (let i = 0; i < LIMITS.aiSolve.limit; i++) {
      expect(enforceRateLimit(request({ 'x-real-ip': '1.2.3.4' }), 'aiSolve', now).allowed).toBe(
        true,
      );
    }

    const blocked = enforceRateLimit(request({ 'x-real-ip': '1.2.3.4' }), 'aiSolve', now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.response?.status).toBe(429);
    expect(blocked.response?.headers.get('retry-after')).toBeTruthy();
  });

  it('does not include the client identity in the error body', async () => {
    const now = 1000;
    for (let i = 0; i < LIMITS.aiExplain.limit; i++) {
      enforceRateLimit(request({ 'x-real-ip': '9.9.9.9' }), 'aiExplain', now);
    }
    const blocked = enforceRateLimit(request({ 'x-real-ip': '9.9.9.9' }), 'aiExplain', now);
    const body = await blocked.response!.text();
    expect(body).toContain('RATE_LIMITED');
    expect(body).not.toContain('9.9.9.9');
  });
});

describe('aiStatusForError', () => {
  it('maps AI error codes to safe HTTP statuses', () => {
    expect(aiStatusForError('MISSING_KEY')).toBe(503);
    expect(aiStatusForError('INVALID_KEY')).toBe(502);
    expect(aiStatusForError('RATE_LIMIT')).toBe(429);
    expect(aiStatusForError('TIMEOUT')).toBe(504);
    expect(aiStatusForError('BAD_REQUEST')).toBe(400);
    expect(aiStatusForError('SOMETHING_ELSE')).toBe(502);
  });
});
