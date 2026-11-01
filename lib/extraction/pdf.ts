import { extractText, renderPageAsImage } from 'unpdf';
import type { PdfExtractionResult } from '../models/exam';
import { normalizePageText } from './text';

export interface PdfAnalysis {
  ok: true;
  pages: string[];
  totalPages: number;
  emptyPages: number[];
}

export interface PdfAnalysisError {
  ok: false;
  code: 'EMPTY' | 'ENCRYPTED' | 'MALFORMED' | 'UNSUPPORTED';
  message: string;
  totalPages?: number;
}

export type PdfAnalysisResult = PdfAnalysis | PdfAnalysisError;

const MIN_PAGE_TEXT = 15;

function toUint8(data: Uint8Array | ArrayBuffer | Buffer): Uint8Array | null {
  if (!data || data.byteLength === 0) return null;
  if (data instanceof Uint8Array) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return null;
}

function classifyError(err: unknown): { code: PdfAnalysisError['code']; message: string } {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
  const msg = err instanceof Error ? err.message : String(err);

  if (name === 'PasswordException' || /password|encrypted/i.test(msg)) {
    return { code: 'ENCRYPTED', message: 'The PDF is password protected or encrypted.' };
  }
  if (name === 'InvalidPDFException' || /invalid pdf|structure|corrupted/i.test(msg)) {
    return { code: 'MALFORMED', message: 'The PDF file is malformed or corrupted.' };
  }
  return { code: 'MALFORMED', message: msg || 'Failed to extract text from PDF.' };
}

/**
 * Analyses every page of a PDF and reports pages with no text layer.
 * Unlike `extractPdfText`, a fully scanned PDF is still `ok: true` here so the
 * pipeline can attempt OCR page by page.
 */
export async function analyzePdfPages(
  data: Uint8Array | ArrayBuffer | Buffer,
): Promise<PdfAnalysisResult> {
  const uint8 = toUint8(data);
  if (!uint8) {
    return { ok: false, code: 'EMPTY', message: 'The PDF file is empty.' };
  }

  try {
    const result = await extractText(uint8, { mergePages: false });
    const totalPages = result.totalPages || 0;

    if (totalPages === 0) {
      return { ok: false, code: 'MALFORMED', message: 'The PDF contains no pages.', totalPages: 0 };
    }

    const rawPages = Array.isArray(result.text) ? result.text : [String(result.text ?? '')];
    const pages = Array.from({ length: totalPages }, (_, i) =>
      normalizePageText(rawPages[i] ?? ''),
    );
    const emptyPages = pages
      .map((page, idx) => ({ page: idx + 1, length: page.replace(/\s+/g, '').length }))
      .filter((p) => p.length < MIN_PAGE_TEXT)
      .map((p) => p.page);

    return { ok: true, pages, totalPages, emptyPages };
  } catch (err: unknown) {
    return { ok: false, ...classifyError(err) };
  }
}

/**
 * Server-side extraction of text from a PDF buffer.
 * Handles empty data, encrypted PDFs, malformed PDFs and scanned PDFs.
 */
export async function extractPdfText(
  data: Uint8Array | ArrayBuffer | Buffer,
): Promise<PdfExtractionResult> {
  const analysis = await analyzePdfPages(data);
  if (!analysis.ok) return analysis;

  const combined = analysis.pages.join('\n\n').trim();
  const nonWhitespaceCount = combined.replace(/\s+/g, '').length;

  if (nonWhitespaceCount < MIN_PAGE_TEXT) {
    return {
      ok: false,
      code: 'EMPTY_OR_SCANNED',
      totalPages: analysis.totalPages,
      message:
        'No readable text layer found in this PDF. It appears to be scanned; OCR fallback is required.',
    };
  }

  return {
    ok: true,
    text: combined,
    pages: analysis.pages,
    totalPages: analysis.totalPages,
    emptyPages: analysis.emptyPages,
    needsOcr: analysis.emptyPages.length > 0,
  };
}

/**
 * Rasterises one PDF page to a PNG buffer for OCR. Canvas support is optional;
 * callers must handle a rejection and report the page as unreadable.
 */
export async function renderPdfPageToPng(
  data: Uint8Array | ArrayBuffer | Buffer,
  pageNumber: number,
  scale = 2,
): Promise<Uint8Array> {
  const uint8 = toUint8(data);
  if (!uint8) throw new Error('EMPTY_PDF');
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('INVALID_PAGE');

  const image = await renderPageAsImage(uint8, pageNumber, {
    scale,
    format: 'png',
    // Lazy import keeps canvas optional and out of client bundles.
    canvasImport: () => import('@napi-rs/canvas'),
  });

  if (typeof image === 'string') throw new Error('RASTERISATION_FAILED');
  return image;
}
