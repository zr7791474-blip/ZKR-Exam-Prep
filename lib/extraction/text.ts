/**
 * Text normalisation and layout recovery for extracted PDF/OCR text.
 *
 * PDF.js and OCR engines both produce artefacts that break deterministic question
 * parsing: soft hyphens, ligatures, non-breaking spaces, repeated page headers,
 * and columns flattened into one line. This module fixes the safe, reversible
 * cases and exposes layout hints without inventing content.
 */

const LIGATURES: Record<string, string> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
  '\uFB05': 'st',
  '\uFB06': 'st',
};

/** Normalises unicode punctuation/whitespace and repairs words split by hyphenation. */
export function normalizePageText(raw: string): string {
  if (!raw) return '';

  let text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/\u00AD/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  for (const [ligature, replacement] of Object.entries(LIGATURES)) {
    text = text.split(ligature).join(replacement);
  }

  // Join words split across lines: "informa-\ntion" -> "information".
  text = text.replace(/([A-Za-z])-\n([a-z])/g, '$1$2');

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
}

/**
 * Detects and removes repeated running headers/footers (page numbers, exam titles)
 * that otherwise become prompt continuations on every page.
 */
export function stripRepeatedPageFurniture(pages: string[]): string[] {
  if (pages.length < 3) return pages;

  const counts = new Map<string, number>();
  const pageLines = pages.map((p) =>
    normalizePageText(p)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );

  for (const lines of pageLines) {
    const candidates = [...lines.slice(0, 2), ...lines.slice(-2)];
    for (const line of new Set(candidates)) {
      if (line.length > 90) continue;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  const repeated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= threshold)
      // Never strip lines that look like content (questions/options).
      .filter(([line]) => !/^\s*(?:q(?:uestion)?\s*)?\d+[\s.:)-]/i.test(line))
      .filter(([line]) => !/^\s*\(?[A-H][).:-]\s+/i.test(line))
      .map(([line]) => line),
  );

  if (repeated.size === 0) return pages;

  return pageLines.map((lines) => lines.filter((line) => !repeated.has(line)).join('\n'));
}

/**
 * Recovers a two-column layout where the PDF text layer emitted both columns on
 * one visual line separated by a wide gap (2+ spaces or a tab).
 *
 * Only splits when both halves look independently useful and the line is not an
 * option/answer row (where wide gaps are intentional).
 */
export function splitColumnLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (/^\s*(?:q(?:uestion)?\s*)?\d+[\s.:)-]/i.test(trimmed)) return [trimmed];
  if (/^\s*\(?[A-H1-9][).:-]\s+/i.test(trimmed)) return [trimmed];
  if (/\b(?:answer|ans|r[ée]ponse)\s*[:=-]/i.test(trimmed)) return [trimmed];

  const parts = trimmed.split(/\s{3,}|\t+/).filter((p) => p.trim().length > 0);
  if (parts.length < 2) return [trimmed];

  const meaningful = parts.filter((p) => /[A-Za-z]{2,}/.test(p));
  if (meaningful.length < 2) return [trimmed];

  return parts.map((p) => p.trim());
}

/** Normalises a whole document while preserving page boundaries. */
export function normalizePages(pages: string[]): string[] {
  return stripRepeatedPageFurniture(pages.map(normalizePageText));
}

/** Collapses whitespace in a single logical field (prompt/option text). */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Heuristically repairs OCR spacing around option labels:
 * "A)Paris B)London" -> "A) Paris B) London".
 */
export function repairOcrOptionSpacing(text: string): string {
  return text.replace(/([A-H])([).:])(?=[A-Za-z0-9(])/g, '$1$2 ');
}

/** Best-effort document classification based on text density per page. */
export function classifyDocument(pages: string[]): 'text_pdf' | 'scanned_pdf' | 'mixed_pdf' {
  if (pages.length === 0) return 'scanned_pdf';
  const empty = pages.filter((p) => p.replace(/\s+/g, '').length < 15).length;
  if (empty === 0) return 'text_pdf';
  if (empty === pages.length) return 'scanned_pdf';
  return 'mixed_pdf';
}
