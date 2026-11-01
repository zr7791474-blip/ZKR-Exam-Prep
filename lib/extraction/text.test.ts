import { describe, expect, it } from 'vitest';
import {
  classifyDocument,
  collapseWhitespace,
  normalizePageText,
  normalizePages,
  repairOcrOptionSpacing,
  splitColumnLine,
  stripRepeatedPageFurniture,
} from './text';

describe('normalizePageText', () => {
  it('normalises unicode punctuation, ligatures, and invisible characters', () => {
    const raw = 'The \uFB01nance \u201Cexam\u201D\u00A0is\u200B ready\u2026';
    expect(normalizePageText(raw)).toBe('The finance "exam" is ready...');
  });

  it('removes soft hyphens and joins words split across lines', () => {
    expect(normalizePageText('co\u00ADoperate and informa-\ntion')).toBe(
      'cooperate and information',
    );
  });

  it('normalises CRLF and trims trailing whitespace per line', () => {
    expect(normalizePageText('Line one   \r\nLine two\t')).toBe('Line one\nLine two');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizePageText('')).toBe('');
  });
});

describe('stripRepeatedPageFurniture', () => {
  it('removes running headers repeated across pages but keeps question content', () => {
    const pages = [
      'ZKR Exam\n1. What is 2 + 2?\nA) 3\nB) 4',
      'ZKR Exam\n2. What is 3 + 3?\nA) 5\nB) 6',
      'ZKR Exam\n3. What is 4 + 4?\nA) 7\nB) 8',
    ];
    const cleaned = stripRepeatedPageFurniture(pages);
    expect(cleaned).toHaveLength(3);
    for (const page of cleaned) {
      expect(page).not.toContain('ZKR Exam');
      expect(page).toMatch(/\d\. What is/);
    }
  });

  it('leaves documents with fewer than three pages untouched', () => {
    const pages = ['ZKR Exam\n1. Question', 'ZKR Exam\n2. Question'];
    expect(stripRepeatedPageFurniture(pages)).toEqual(pages);
  });
});

describe('splitColumnLine', () => {
  it('splits two-column text separated by a wide gap', () => {
    expect(splitColumnLine('First column text     Second column text')).toEqual([
      'First column text',
      'Second column text',
    ]);
  });

  it('does not split question or option rows', () => {
    expect(splitColumnLine('1. Which answer is correct?     A) Yes')).toEqual([
      '1. Which answer is correct?     A) Yes',
    ]);
    expect(splitColumnLine('A) London     B) Paris')).toEqual(['A) London     B) Paris']);
  });

  it('does not split answer-key rows', () => {
    expect(splitColumnLine('Answer: A     B     C')).toEqual(['Answer: A     B     C']);
  });
});

describe('normalizePages', () => {
  it('normalises every page while preserving page boundaries', () => {
    const pages = ['Page \uFB01rst', 'Page \u00ADsecond'];
    expect(normalizePages(pages)).toEqual(['Page first', 'Page second']);
  });
});

describe('collapseWhitespace and OCR repair', () => {
  it('collapses whitespace in a field', () => {
    expect(collapseWhitespace('  hello \n  world  ')).toBe('hello world');
  });

  it('repairs spacing after OCR option labels', () => {
    expect(repairOcrOptionSpacing('A)Paris B)London')).toBe('A) Paris B) London');
  });
});

describe('classifyDocument', () => {
  it('classifies text, scanned, and mixed documents', () => {
    expect(classifyDocument(['This page has plenty of readable text content.'])).toBe('text_pdf');
    expect(classifyDocument(['short', 'tiny'])).toBe('scanned_pdf');
    expect(classifyDocument(['This page has plenty of readable text content.', ''])).toBe(
      'mixed_pdf',
    );
    expect(classifyDocument([])).toBe('scanned_pdf');
  });
});
