import { clientKey, rateLimit, type RateLimitOptions } from './rate-limit';

/**
 * Server-side request budgets. These are deliberately conservative because OCR
 * and AI calls are expensive. Tune them per deployment.
 */
export const LIMITS = {
  upload: { limit: 20, windowMs: 60_000 },
  aiStatus: { limit: 120, windowMs: 60_000 },
  aiSolve: { limit: 10, windowMs: 60_000 },
  aiExplain: { limit: 30, windowMs: 60_000 },
  aiChallenge: { limit: 20, windowMs: 60_000 },
  aiSimilar: { limit: 20, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>;

export interface LimitCheck {
  allowed: boolean;
  response?: Response;
}

/**
 * Applies an in-memory rate limit and returns a ready-to-send 429 response when
 * the caller is over budget. Never includes the client key in the response.
 */
export function enforceRateLimit(
  request: Request,
  scope: keyof typeof LIMITS,
  now = Date.now(),
): LimitCheck {
  const result = rateLimit(clientKey(request, scope), LIMITS[scope], now);
  if (result.allowed) return { allowed: true };

  return {
    allowed: false,
    response: Response.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please wait and try again.',
        },
      },
      {
        status: 429,
        headers: { 'retry-after': String(Math.max(1, result.retryAfterSeconds)) },
      },
    ),
  };
}

/** Maps AI error codes to safe HTTP statuses. */
export function aiStatusForError(code: string): number {
  switch (code) {
    case 'MISSING_KEY':
      return 503;
    case 'INVALID_KEY':
      return 502;
    case 'RATE_LIMIT':
      return 429;
    case 'TIMEOUT':
      return 504;
    case 'CANCELLED':
      return 499;
    case 'INVALID_RESPONSE':
      return 502;
    case 'BAD_REQUEST':
      return 400;
    default:
      return 502;
  }
}
