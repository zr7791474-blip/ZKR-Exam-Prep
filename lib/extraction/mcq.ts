import type {
  ConfidenceLevel,
  DocumentProcessingReport,
  ProcessingPage,
  Question,
  QuestionOption,
  QuestionType,
} from '../models/exam';
import { questionFingerprint } from '../exam/fingerprint';
import { classifyDocument, collapseWhitespace, normalizePageText } from './text';

interface RawOption {
  label: string;
  text: string;
  markedCorrect?: boolean;
}

interface ParsedRawQuestion {
  number: number;
  pageNumber: number;
  promptLines: string[];
  options: RawOption[];
  answerLabels: string[];
  answerTextHint?: string;
  explanationLines: string[];
  hasDiagramHint: boolean;
}

interface SourceLine {
  text: string;
  page: number;
}

export interface ParseOptions {
  pages?: string[];
  /** Retain questions with fewer than two options as free-response/needs-review. */
  keepNonMcq?: boolean;
  /** Drop exact duplicate questions (same prompt + options). Defaults to true. */
  dedupe?: boolean;
}

export interface ParseResult {
  questions: Question[];
  report: DocumentProcessingReport;
}

const TRUE_VALUES = new Set(['TRUE', 'T', 'YES', 'Y', 'VRAI', 'V', 'CORRECT']);
const FALSE_VALUES = new Set(['FALSE', 'F', 'NO', 'N', 'FAUX', 'INCORRECT']);

function normalizeLabel(value: string): string {
  return value.trim().replace(/^[([{]|[)\]}]$/g, '').toUpperCase();
}

function splitAnswerLabels(raw: string): string[] {
  return raw
    .split(/\s*(?:,|;|\/|&|\+|\band\b|\bet\b)\s*/i)
    .map(normalizeLabel)
    .filter(Boolean);
}

function inferSubjectTopic(text: string): string {
  const lower = text.toLowerCase();
  if (/```|#include|public\s+static\s+void|console\.log|def\s+\w+\(|function\s+\w+\(|class\s+\w+|SELECT\s+.+\s+FROM|std::|<\w+>/.test(text)) {
    return 'Programming';
  }
  if (/\b(?:tcp|udp|ipv4|ipv6|dns|http|https|router|switch|osi|packet|subnet|vlan|dhcp|arp|tls|port\s+\d+)\b/i.test(lower)) {
    return 'Networking';
  }
  if (/\b(?:database|sql|primary\s+key|foreign\s+key|normalization|join|index|transaction|acid)\b/i.test(lower)) {
    return 'Databases';
  }
  if (/\b(?:integral|derivative|matrix|vector|polynomial|equation|theorem|probability|sin|cos|tan|log|limit)\b/i.test(lower) || /\d+\s*[+\-*/^=]\s*\d+/.test(text)) {
    return 'Mathematics';
  }
  if (/\b(?:newton|joule|velocity|acceleration|voltage|current|ohm|frequency|circuit|resistor|momentum|energy|force)\b/i.test(lower)) {
    return 'Physics';
  }
  if (/\b(?:dna|rna|cell|mitochondria|photosynthesis|organism|protein|enzyme|membrane|gene)\b/i.test(lower)) {
    return 'Biology';
  }
  if (/\b(?:grammar|tense|verb|noun|adjective|plural|pronoun|conjugation|synonym|antonym|sentence)\b/i.test(lower)) {
    return 'Languages';
  }
  return 'General Assessment';
}

function checkDiagramReference(text: string): boolean {
  return /\b(?:figure|diagram|chart|graph|circuit|schematic|screenshot|image below|illustrated in|shown below|table \d+)\b/i.test(
    text,
  );
}

function cleanText(s: string): string {
  return collapseWhitespace(
    s
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"'),
  );
}

/** Builds a page-aware line list without the drift caused by joining pages. */
function buildLines(pages: string[]): SourceLine[] {
  const lines: SourceLine[] = [];
  pages.forEach((page, index) => {
    const normalised = normalizePageText(page);
    for (const line of normalised.split('\n')) {
      lines.push({ text: line, page: index + 1 });
    }
  });
  return lines;
}

/** Parses a question number from a line, returning null when it is not a start. */
function parseQuestionStart(text: string): { number: number; rest: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const prefixed = trimmed.match(
    /^(?:question|q|item|exerc(?:ice)?|problem)\s*(\d{1,3})\s*(?:[.):-]\s*|\s+)(.*)$/i,
  );
  if (prefixed) {
    return { number: parseInt(prefixed[1], 10), rest: prefixed[2] ?? '' };
  }

  const numbered = trimmed.match(/^(\d{1,3})(?!\d)\s*[.):-]\s*(.*)$/);
  if (numbered) {
    return { number: parseInt(numbered[1], 10), rest: numbered[2] ?? '' };
  }

  const bare = trimmed.match(/^(\d{1,3})(?!\d)\s*$/);
  if (bare) return { number: parseInt(bare[1], 10), rest: '' };

  return null;
}

function stripTrailingMark(text: string): { text: string; marked: boolean } {
  const match = text.match(/\s*(?:[*✓✔]|\((?:correct|x)\)|\[(?:correct|x)\])\s*$/i);
  if (!match) return { text, marked: false };
  return { text: text.slice(0, match.index).trim(), marked: true };
}

/** Parses a single option line such as `A) text`, `(A) text`, `[A] text`. */
function parseOptionStart(
  text: string,
  allowNumeric = true,
): { label: string; text: string; marked: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let marked = false;
  let rest = trimmed;
  const leadingMark = rest.match(/^(?:[*✓✔]|\((?:x|correct)\)|\[(?:x|correct)\])\s*/i);
  if (leadingMark) {
    marked = true;
    rest = rest.slice(leadingMark[0].length);
  }

  let label: string | null = null;
  const patterns: RegExp[] = [
    /^\(([A-Ha-h])\)\s*(.*)$/,
    /^\[([A-Ha-h])\]\s*(.*)$/,
    /^([A-Ha-h])[).:]\s*(.*)$/,
    /^([A-Ha-h])\s+[-–]\s*(.*)$/,
  ];
  if (allowNumeric) {
    patterns.push(/^\((\d{1,2})\)\s*(.*)$/, /^\[(\d{1,2})\]\s*(.*)$/);
  }

  for (const pattern of patterns) {
    const match = rest.match(pattern);
    if (match) {
      label = match[1].toUpperCase();
      rest = match[2] ?? '';
      break;
    }
  }

  if (!label) return null;

  const trailing = stripTrailingMark(rest);
  return { label, text: trailing.text, marked: marked || trailing.marked };
}

/**
 * Splits horizontal options on one line, e.g. `A) London   B) Paris`.
 * Requires at least two sequential labels to avoid splitting prose.
 */
function splitInlineOptions(text: string): { options: RawOption[]; startIndex: number } {
  const labelRegex =
    /(?:^|(?<=\s))(?:([*✓✔])\s*)?(?:\(([A-Ha-h])\)|\[([A-Ha-h])\]|([A-Ha-h])[).:]|\((\d{1,2})\)|\[(\d{1,2})\])\s+/g;

  const matches: { label: string; index: number; end: number; marked: boolean }[] = [];
  let match: RegExpExecArray | null;
  while ((match = labelRegex.exec(text)) !== null) {
    const label = (match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6] ?? '').toUpperCase();
    if (!label) continue;
    matches.push({
      label,
      index: match.index,
      end: match.index + match[0].length,
      marked: Boolean(match[1]),
    });
  }

  if (matches.length < 2) return { options: [], startIndex: -1 };

  // Only accept a sequential run beginning at A or 1.
  const first = matches[0].label;
  const isLetters = /^[A-H]$/.test(first);
  const isNumbers = /^\d+$/.test(first);
  if (!isLetters && !isNumbers) return { options: [], startIndex: -1 };
  if (isLetters && first !== 'A') return { options: [], startIndex: -1 };
  if (isNumbers && first !== '1') return { options: [], startIndex: -1 };

  const sequential = matches.every((m, idx) => {
    if (isLetters) return m.label === String.fromCharCode(65 + idx);
    return m.label === String(idx + 1);
  });
  if (!sequential) return { options: [], startIndex: -1 };

  const options: RawOption[] = [];
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    let value = text.slice(matches[i].end, end).trim();
    const trailing = stripTrailingMark(value);
    value = trailing.text;
    options.push({
      label: matches[i].label,
      text: value,
      markedCorrect: matches[i].marked || trailing.marked,
    });
  }

  return { options, startIndex: matches[0].index };
}

function readLeadingAnswerLabels(value: string): { labels: string[]; rest: string } {
  const labels: string[] = [];
  let rest = value.trim();
  const matched = rest.match(/^(?:answer\s+is\s+|option\s+|choice\s+)?\(?([A-Ha-h1-9])\)?/i);
  if (!matched) return { labels, rest };

  labels.push(matched[1].toUpperCase());
  rest = rest.slice(matched[0].length);

  while (labels.length < 8) {
    const more = rest.match(/^\s*(?:,|;|\/|&|\+|and)\s*\(?([A-Ha-h1-9])\)?/i);
    if (!more) break;
    labels.push(more[1].toUpperCase());
    rest = rest.slice(more[0].length);
  }

  return { labels, rest: rest.replace(/^[\s.:,-]+/, '').trim() };
}

function extractTrailingAnswer(text: string): { rest: string; labels: string[]; explanation?: string } {
  const match = text.match(
    /\s*(?:correct\s*(?:answer|choice|option)|answer|ans|r[ée]ponse|solution)\s*[:=.-]\s*(.+)$/i,
  );
  if (!match) return { rest: text, labels: [] };

  const value = match[1].trim();
  const { labels, rest } = readLeadingAnswerLabels(value);
  if (labels.length === 0) return { rest: text, labels: [] };

  // Reject when the "label" is really the start of a prose sentence.
  if (labels.length === 1 && /^[A-H]$/.test(labels[0]) && value.length > 6 && !/^[A-H][\s.:,-]/.test(value)) {
    return { rest: text, labels: [] };
  }

  return {
    rest: text.slice(0, match.index).trim(),
    labels,
    explanation: rest || undefined,
  };
}

/** Parses a free-text answer value into labels (letters, numbers, true/false). */
function parseAnswerValue(value: string): { labels: string[]; explanation?: string } {
  const trimmed = value.trim();
  if (!trimmed) return { labels: [] };

  const leading = readLeadingAnswerLabels(trimmed);
  if (leading.labels.length > 0) {
    return { labels: leading.labels, explanation: leading.rest || undefined };
  }

  if (/^(true|false|yes|no|vrai|faux)\b/i.test(trimmed)) {
    const word = trimmed.split(/\s+/)[0].toUpperCase();
    return { labels: [word], explanation: trimmed.slice(word.length).trim() || undefined };
  }

  const labels = splitAnswerLabels(trimmed).filter((label) =>
    /^[A-H]$/.test(label) || /^\d{1,2}$/.test(label),
  );
  if (labels.length > 0) return { labels };
  return { labels: [] };
}

/**
 * Extracts a document-level answer key. Handles explicit headers and dense
 * "1-B 2-C 3-D" key lines. Returns the remaining exam lines.
 */
export function extractAnswerKey(lines: SourceLine[]): {
  answerKey: Map<number, string[]>;
  examLines: SourceLine[];
} {
  const answerKey = new Map<number, string[]>();
  const headerRegex =
    /^\s*(?:answer\s*key|answer\s*sheet|answers?|solutions?|corrig[ée]|cl[ée]\s+de\s+r[ée]ponses?)\s*[:.-]?\s*$/i;

  let headerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const text = lines[i].text.trim();
    if (text.length > 60) continue;
    if (headerRegex.test(text) && (lines.length < 20 || i > lines.length * 0.4)) {
      headerIndex = i;
      break;
    }
  }

  const keyEntries = new Map<number, string[]>();
  const entryRegex =
    /(?:^|[\s,;|])(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.):=-]?\s*([A-Ha-h](?:\s*(?:,|&|\/|\+|and)\s*[A-Ha-h])*)\b/g;

  function collectKeyEntries(source: string) {
    let match: RegExpExecArray | null;
    while ((match = entryRegex.exec(source)) !== null) {
      const number = parseInt(match[1], 10);
      if (Number.isNaN(number)) continue;
      const labels = splitAnswerLabels(match[2]);
      if (labels.length > 0) keyEntries.set(number, labels);
    }
  }

  if (headerIndex !== -1) {
    for (const line of lines.slice(headerIndex + 1)) collectKeyEntries(line.text);
  }

  // Dense key lines without a header (common at the bottom of a page).
  const denseKeyRegex = /^\s*(?:(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.):=-]?\s*[A-Ha-h]\s*[,;|]?\s*){2,}$/;
  const denseKeyLines = new Set<number>();
  lines.forEach((line, index) => {
    if (index === headerIndex) return;
    if (denseKeyRegex.test(line.text) && line.text.trim().length < 120) {
      collectKeyEntries(line.text);
      denseKeyLines.add(index);
    }
  });

  // Only accept the header split when it produced a plausible key.
  const headerUsable = headerIndex !== -1 && keyEntries.size >= 2;
  const examLines = lines.filter((line, index) => {
    if (headerUsable && index >= headerIndex) return false;
    if (denseKeyLines.has(index)) return false;
    return true;
  });

  if (!headerUsable && denseKeyLines.size === 0) {
    return { answerKey: new Map(), examLines: lines };
  }

  for (const [number, labels] of keyEntries) answerKey.set(number, labels);
  return { answerKey, examLines };
}

function resolveAnswerLabels(
  labels: string[],
  options: RawOption[],
): { ids: string[]; resolvedLabels: string[]; unresolved: string[] } {
  const ids: string[] = [];
  const resolvedLabels: string[] = [];
  const unresolved: string[] = [];

  for (const rawLabel of labels) {
    const label = normalizeLabel(rawLabel);
    let index = -1;

    if (/^[A-H]$/.test(label)) {
      index = options.findIndex((o) => o.label.toUpperCase() === label);
    } else if (/^\d{1,2}$/.test(label)) {
      index = parseInt(label, 10) - 1;
    } else if (TRUE_VALUES.has(label)) {
      index = options.findIndex((o) => TRUE_VALUES.has(normalizeLabel(o.text)));
    } else if (FALSE_VALUES.has(label)) {
      index = options.findIndex((o) => FALSE_VALUES.has(normalizeLabel(o.text)));
    } else {
      index = options.findIndex((o) => normalizeLabel(o.text) === label);
    }

    if (index >= 0 && index < options.length) {
      const id = `opt-${index + 1}`;
      if (!ids.includes(id)) {
        ids.push(id);
        resolvedLabels.push(options[index].label.toUpperCase());
      }
    } else {
      unresolved.push(rawLabel);
    }
  }

  return { ids, resolvedLabels, unresolved };
}

function isLikelyPageFurniture(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^(?:page\s*)?\d{1,3}\s*(?:\/|of)\s*\d{1,3}$/i.test(trimmed)) return true;
  if (/^page\s+\d{1,3}$/i.test(trimmed)) return true;
  if (/^[-–—_]{3,}$/.test(trimmed)) return true;
  return false;
}

/**
 * Parses lines into raw question records while tracking page numbers and
 * cross-page continuations.
 */
function parseRawQuestions(lines: SourceLine[]): ParsedRawQuestion[] {
  const questions: ParsedRawQuestion[] = [];
  let current: ParsedRawQuestion | null = null;
  let currentOption: RawOption | null = null;
  let inCodeFence = false;

  const finalizeOption = () => {
    if (currentOption && current) {
      current.options.push(currentOption);
      currentOption = null;
    }
  };

  const finalizeQuestion = () => {
    finalizeOption();
    if (current) questions.push(current);
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (!trimmed) continue;

    if (/^```/.test(trimmed)) {
      inCodeFence = !inCodeFence;
      if (current) {
        if (current.options.length === 0) current.promptLines.push(trimmed);
        else if (currentOption) currentOption.text += ` ${trimmed}`;
      }
      continue;
    }
    if (inCodeFence) {
      if (current) {
        if (current.options.length === 0) current.promptLines.push(line.text);
        else if (currentOption) currentOption.text += ` ${line.text}`;
      }
      continue;
    }

    if (isLikelyPageFurniture(trimmed)) continue;

    // Explicit answer / correction line.
    const answerLine = trimmed.match(
      /^\s*(?:correct\s*(?:answer|choice|option)|answer|ans|r[ée]ponse|solution|correction)\s*[:=.-]\s*(.+)$/i,
    );
    if (answerLine && current) {
      finalizeOption();
      const parsed = parseAnswerValue(answerLine[1]);
      if (parsed.labels.length > 0) current.answerLabels.push(...parsed.labels);
      else current.answerTextHint = answerLine[1].trim();
      if (parsed.explanation) current.explanationLines.push(parsed.explanation);
      continue;
    }

    const correctionLine = trimmed.match(
      /^\s*(?:the\s+correct\s+answer\s+is|correct\s+answer\s+is|correction|explication|explanation)\s*[:=-]?\s*(.+)$/i,
    );
    if (correctionLine && current) {
      const parsed = parseAnswerValue(correctionLine[1]);
      if (parsed.labels.length > 0) current.answerLabels.push(...parsed.labels);
      current.explanationLines.push(correctionLine[1]);
      continue;
    }

    const questionStart = parseQuestionStart(trimmed);
    const optionStart = parseOptionStart(trimmed);
    const currentHasOptions = Boolean(current && current.options.length > 0);
    const looksLikeOption =
      current &&
      optionStart &&
      (currentHasOptions || optionStart.label !== String(current.number)) &&
      !(questionStart && !optionStart);

    if (questionStart && !looksLikeOption) {
      finalizeQuestion();

      let remainder = questionStart.rest.trim();
      const trailingAnswer = extractTrailingAnswer(remainder);
      remainder = trailingAnswer.rest;
      const inline = splitInlineOptions(remainder);

      const promptLines: string[] = [];
      const options: RawOption[] = [];
      if (inline.options.length >= 2) {
        const promptPart = remainder.slice(0, inline.startIndex).trim();
        if (promptPart) promptLines.push(promptPart);
        options.push(...inline.options);
      } else if (remainder) {
        promptLines.push(remainder);
      }

      current = {
        number: questionStart.number,
        pageNumber: line.page,
        promptLines,
        options,
        answerLabels: trailingAnswer.labels,
        explanationLines: trailingAnswer.explanation ? [trailingAnswer.explanation] : [],
        hasDiagramHint: checkDiagramReference(remainder),
      };
      currentOption = null;
      continue;
    }

    if (!current) continue;

    // Horizontal options.
    const inline = splitInlineOptions(trimmed);
    if (inline.options.length >= 2) {
      finalizeOption();
      current.options.push(...inline.options);
      continue;
    }

    // Single option.
    if (optionStart) {
      finalizeOption();
      currentOption = {
        label: optionStart.label,
        text: optionStart.text,
        markedCorrect: optionStart.marked,
      };
      continue;
    }

    if (currentOption) {
      // Option text continuation.
      currentOption.text = `${currentOption.text} ${trimmed}`.trim();
      continue;
    }

    if (current.options.length === 0) {
      // Prompt continuation, including cross-page breaks.
      current.promptLines.push(trimmed);
      if (checkDiagramReference(trimmed)) current.hasDiagramHint = true;
      continue;
    }

    // Text after the option block: treat as explanation, otherwise append to the
    // last option (multiline option text).
    if (/^(?:explanation|explication|why|reason)\b/i.test(trimmed)) {
      current.explanationLines.push(trimmed);
    } else if (current.options.length > 0) {
      current.options[current.options.length - 1].text =
        `${current.options[current.options.length - 1].text} ${trimmed}`.trim();
    }
  }

  finalizeQuestion();
  return questions;
}

function determineQuestionType(options: RawOption[], correctIds: string[]): QuestionType {
  if (options.length === 0) return 'free_response';
  if (options.length === 2) {
    const texts = options.map((o) => normalizeLabel(o.text));
    if (texts.every((t) => TRUE_VALUES.has(t) || FALSE_VALUES.has(t))) return 'true_false';
  }
  if (correctIds.length > 1) return 'multiple_choice';
  return 'single_choice';
}

function confidenceFor(
  hasKnownAnswer: boolean,
  optionCount: number,
  promptLength: number,
  hasDiagram: boolean,
  malformed: boolean,
): ConfidenceLevel {
  if (malformed || hasDiagram || promptLength < 12) return 'low';
  if (!hasKnownAnswer) return 'medium';
  if (optionCount < 3) return 'medium';
  return 'high';
}

/**
 * Extracts questions from text or page arrays, tracking source pages, cross-page
 * continuations, answer keys, subject topics, and completeness diagnostics.
 */
export function parseQuestionsFromText(
  textOrPages: string | string[],
  options?: ParseOptions,
): Question[] {
  return parseExamContent(textOrPages, options).questions;
}

/**
 * Comprehensive parser returning both questions and the full report.
 */
export function parseExamContent(
  textOrPages: string | string[],
  options?: ParseOptions,
): ParseResult {
  let pages: string[] = [];

  if (Array.isArray(textOrPages)) {
    pages = textOrPages;
  } else if (options?.pages && options.pages.length > 0) {
    pages = options.pages;
  } else if (typeof textOrPages === 'string') {
    pages = textOrPages.includes('\f') ? textOrPages.split('\f') : [textOrPages];
  }

  const keepNonMcq = options?.keepNonMcq ?? false;
  const dedupe = options?.dedupe ?? true;

  const lines = buildLines(pages);
  const { answerKey, examLines } = extractAnswerKey(lines);
  const rawQuestions = parseRawQuestions(examLines);

  const questions: Question[] = [];
  const malformedQuestions: { index: number; reason: string }[] = [];
  const potentialDuplicates: { q1Index: number; q2Index: number; prompt: string }[] = [];
  const warnings: string[] = [];
  const fingerprintMap = new Map<string, number>();
  const promptMap = new Map<string, number>();
  const usedQuestionIds = new Set<string>();

  let officialCount = 0;
  let unkeyedCount = 0;
  let needsReviewCount = 0;
  let droppedDuplicates = 0;
  let previousNumber: number | null = null;

  for (let i = 0; i < rawQuestions.length; i++) {
    const raw = rawQuestions[i];
    const prompt = cleanText(raw.promptLines.join(' '));

    if (previousNumber !== null && raw.number > previousNumber + 1) {
      warnings.push(
        `Question numbering jumps from ${previousNumber} to ${raw.number}; a question may be missing or the document uses sections.`,
      );
    }
    previousNumber = raw.number;

    if (!prompt) {
      malformedQuestions.push({ index: i + 1, reason: 'Empty prompt text' });
      continue;
    }

    if (raw.options.length < 2 && !keepNonMcq) {
      malformedQuestions.push({
        index: i + 1,
        reason:
          raw.options.length === 0
            ? 'No multiple-choice options found (free-response content was not retained).'
            : `Only ${raw.options.length} option found (minimum 2 required).`,
      });
      continue;
    }

    const rawOptions = raw.options.map((opt) => ({ ...opt }));
    const keyLabels = answerKey.get(raw.number);
    if (keyLabels && raw.answerLabels.length === 0) {
      raw.answerLabels.push(...keyLabels);
    }
    const effectiveLabels =
      raw.answerLabels.length > 0
        ? raw.answerLabels
        : rawOptions.filter((opt) => opt.markedCorrect).map((opt) => opt.label);
    const { ids, resolvedLabels, unresolved } = resolveAnswerLabels(effectiveLabels, rawOptions);
    const hasKnownAnswer = ids.length > 0;
    const hasDiagram = raw.hasDiagramHint || checkDiagramReference(prompt);

    if (raw.answerLabels.length > 0 && unresolved.length > 0) {
      malformedQuestions.push({
        index: i + 1,
        reason: `Answer label(s) ${unresolved.join(', ')} do not match any extracted option.`,
      });
    }

    if (raw.options.length > 0 && raw.options.length < 2) {
      malformedQuestions.push({
        index: i + 1,
        reason: `Only ${raw.options.length} option found; question retained for manual review.`,
      });
    }

    const questionIdBase = `q${raw.number}`;
    const questionId = usedQuestionIds.has(questionIdBase)
      ? `${questionIdBase}-${i + 1}`
      : questionIdBase;
    usedQuestionIds.add(questionId);
    const optionId = (index: number) => `${questionId}-opt-${index + 1}`;

    const options: QuestionOption[] = rawOptions.map((opt, optIndex) => {
      const id = optionId(optIndex);
      const isCorrect = hasKnownAnswer ? ids.includes(`opt-${optIndex + 1}`) : undefined;
      return {
        id,
        label: opt.label.toUpperCase(),
        text: cleanText(opt.text),
        ...(isCorrect !== undefined ? { isCorrect } : {}),
      };
    });

    const correctIds = ids.map((id) => {
      const index = parseInt(id.replace('opt-', ''), 10) - 1;
      return optionId(index);
    });

    const questionType = determineQuestionType(rawOptions, correctIds);
    const malformed =
      (raw.answerLabels.length > 0 && !hasKnownAnswer) ||
      (raw.options.length > 0 && raw.options.length < 2) ||
      (raw.options.length >= 2 && new Set(rawOptions.map((o) => o.label)).size !== rawOptions.length);

    let answerStatus: Question['answerStatus'] = hasKnownAnswer
      ? 'official_answer'
      : 'unanswered';
    if (hasDiagram || malformed) answerStatus = 'needs_review';

    if (hasKnownAnswer) officialCount++;
    else unkeyedCount++;
    if (answerStatus === 'needs_review') needsReviewCount++;

    const confidence = confidenceFor(
      hasKnownAnswer,
      rawOptions.length,
      prompt.length,
      hasDiagram,
      malformed,
    );

    const explanation = raw.explanationLines.length
      ? cleanText(raw.explanationLines.join(' '))
      : undefined;

    const subjectTopic = inferSubjectTopic(`${prompt} ${rawOptions.map((o) => o.text).join(' ')}`);

    const fingerprint = questionFingerprint({
      prompt,
      options: rawOptions.map((o) => ({ text: o.text })),
    });

    const normalizedPrompt = prompt.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (promptMap.has(normalizedPrompt)) {
      potentialDuplicates.push({
        q1Index: promptMap.get(normalizedPrompt)!,
        q2Index: questions.length + 1,
        prompt: prompt.slice(0, 60),
      });
    } else {
      promptMap.set(normalizedPrompt, questions.length + 1);
    }

    if (fingerprintMap.has(fingerprint)) {
      potentialDuplicates.push({
        q1Index: fingerprintMap.get(fingerprint)!,
        q2Index: questions.length + 1,
        prompt: prompt.slice(0, 60),
      });
      if (dedupe) {
        droppedDuplicates++;
        continue;
      }
    } else {
      fingerprintMap.set(fingerprint, questions.length + 1);
    }

    questions.push({
      id: questionId,
      index: questions.length + 1,
      prompt,
      options,
      correctOptionId: correctIds[0] ?? null,
      ...(correctIds.length > 1 ? { correctOptionIds: correctIds } : {}),
      hasKnownAnswer,
      confidence,
      questionType,
      ...(questionType === 'free_response' ? { acceptedAnswers: [] } : {}),
      pageNumber: raw.pageNumber,
      sourceReference: `Page ${raw.pageNumber}, Item ${raw.number}`,
      answerStatus,
      verificationLevel: 1,
      ...(resolvedLabels.length > 0 ? { officialAnswerLabel: resolvedLabels.join(', ') } : {}),
      ...(resolvedLabels.length > 1 ? { officialAnswerLabels: resolvedLabels } : {}),
      officialCorrectOptionId: correctIds[0] ?? null,
      ...(correctIds.length > 1 ? { officialCorrectOptionIds: correctIds } : {}),
      subjectTopic,
      hasDiagram,
      ...(explanation ? { explanation } : {}),
      ...(raw.answerTextHint ? { missingInformation: [raw.answerTextHint] } : {}),
      fingerprint,
      generation: 'source',
    });
  }

  if (droppedDuplicates > 0) {
    warnings.push(`Removed ${droppedDuplicates} exact duplicate question(s).`);
  }

  // Completeness diagnostics per page.
  const pageQuestionCounts = new Map<number, number>();
  for (const q of questions) {
    const page = q.pageNumber ?? 1;
    pageQuestionCounts.set(page, (pageQuestionCounts.get(page) ?? 0) + 1);
  }

  const suspiciousPages: DocumentProcessingReport['suspiciousPages'] = [];
  pages.forEach((pageText, idx) => {
    const pageNumber = idx + 1;
    const trimmed = pageText.trim();
    if ((pageQuestionCounts.get(pageNumber) ?? 0) === 0 && trimmed.length > 50) {
      const looksLikeExam =
        /(?:question|q\d|exerc|problem|\b[A-D]\)|\b\d{1,3}[.)]\s)/i.test(trimmed);
      if (looksLikeExam) {
        suspiciousPages.push({
          page: pageNumber,
          textSnippet: cleanText(trimmed).slice(0, 100),
          reason: 'Page contains question-like text but no complete question was reconstructed.',
        });
      }
    }
  });

  const processingPages: ProcessingPage[] = pages.map((pageText, idx) => ({
    pageNumber: idx + 1,
    textLength: pageText.replace(/\s+/g, '').length,
    questionCount: pageQuestionCounts.get(idx + 1) ?? 0,
    method: pageText.replace(/\s+/g, '').length > 0 ? 'text' : 'none',
  }));

  const report: DocumentProcessingReport = {
    totalPages: pages.length,
    pagesProcessed: pages.length,
    extractedCount: questions.length,
    officialAnswerCount: officialCount,
    aiSolvedCount: 0,
    aiProposedCount: 0,
    aiVerifiedCount: 0,
    disputedCount: 0,
    needsReviewCount,
    unkeyedCount,
    suspiciousPages,
    potentialDuplicates,
    malformedQuestions,
    ocrUsed: false,
    ocrPages: [],
    emptyPages: pages
      .map((p, i) => ({ p, i: i + 1 }))
      .filter(({ p }) => p.replace(/\s+/g, '').length < 15)
      .map(({ i }) => i),
    failedPages: [],
    warnings,
    documentKind: classifyDocument(pages),
    pages: processingPages,
    durationMs: 0,
  };

  return { questions, report };
}
