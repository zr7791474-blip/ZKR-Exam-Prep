import { createHash } from 'node:crypto';

/**
 * Stable, order-independent fingerprint for a question. Used to avoid duplicate
 * AI requests and duplicate extracted questions. Never contains raw document text
 * beyond a one-way hash.
 */
export function questionFingerprint(question: {
  prompt: string;
  options: { text: string; label?: string }[];
}): string {
  const prompt = question.prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const options = question.options
    .map((o) => o.text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
    .sort()
    .join('|');
  return createHash('sha256').update(`${prompt}::${options}`).digest('hex').slice(0, 32);
}

/** Short fingerprint for an arbitrary string (explanations, challenge requests). */
export function textFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
