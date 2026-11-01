interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Small in-memory sliding-window limiter. It protects a single server instance;
 * serverless/multi-instance deployments should add a shared store (Redis) at the
 * edge. Documented in README.
 */
export function rateLimit(
  key: string,
  options: RateLimitOptions,
  now = Date.now(),
): RateLimitResult {
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest) buckets.delete(oldest);
  }

  const bucket = buckets.get(key) ?? { hits: [] };
  const windowStart = now - options.windowMs;
  bucket.hits = bucket.hits.filter((timestamp) => timestamp > windowStart);

  if (bucket.hits.length >= options.limit) {
    const oldest = bucket.hits[0];
    const retryAfterMs = Math.max(0, oldest + options.windowMs - now);
    buckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: Math.max(0, options.limit - bucket.hits.length),
    retryAfterSeconds: 0,
  };
}

/** Best-effort client identity. Never trusted for authentication. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const real = request.headers.get('x-real-ip')?.trim();
  const ip = forwarded || real || 'unknown';
  return `${scope}:${ip}`;
}

export function resetRateLimits(): void {
  buckets.clear();
}
