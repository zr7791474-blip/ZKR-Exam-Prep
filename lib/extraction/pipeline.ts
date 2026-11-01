import type {
  DocumentProcessingReport,
  ExtractionResult,
  ProcessingPage,
  ProcessingStageEvent,
  Question,
} from '../models/exam';
import { parseExamContent } from './mcq';
import {
  analyzePdfPages,
  extractPdfText,
  renderPdfPageToPng,
} from './pdf';
import {
  isOcrAvailable,
  isPdfRasterisationAvailable,
  OcrError,
  ocrImage,
} from './ocr';
import { normalizePages } from './text';

export const MAX_DOCUMENT_PAGES = 200;
export const MAX_OCR_PAGES = 30;

export type StageListener = (event: ProcessingStageEvent) => void;

export interface PipelineOptions {
  /** `auto` OCRs pages with no text layer; `off` reports them instead. */
  ocr?: 'auto' | 'off';
  maxOcrPages?: number;
  ocrTimeoutMs?: number;
  maxPages?: number;
  keepNonMcq?: boolean;
  /** Optional AI solving hook. Must return a partial result, never throw for one bad question. */
  solve?: (questions: Question[]) => Promise<{
    questions: Question[];
    solvedCount: number;
    disputedCount: number;
    verifiedCount: number;
    warnings?: string[];
  }>;
  onStage?: StageListener;
  now?: () => number;
}

function emit(
  listener: StageListener | undefined,
  stage: ProcessingStageEvent['stage'],
  label: string,
  completed: boolean,
  extra: Partial<ProcessingStageEvent> = {},
) {
  listener?.({ stage, label, completed, ...extra });
}

function mergeReport(
  report: DocumentProcessingReport,
  pages: ProcessingPage[],
  extra: Partial<DocumentProcessingReport>,
): DocumentProcessingReport {
  return {
    ...report,
    ...extra,
    pages,
    pagesProcessed: pages.filter((p) => p.method !== 'none').length,
    ocrUsed: pages.some((p) => p.method === 'ocr'),
    ocrPages: pages.filter((p) => p.method === 'ocr').map((p) => p.pageNumber),
  };
}

/**
 * Full document-processing pipeline:
 * validation is done by the API, then text extraction, OCR fallback,
 * page-aware question reconstruction, answer-key recovery and optional AI solving.
 *
 * Every stage reports real completion; nothing is marked done before it runs.
 */
export async function processDocument(
  input: { kind: 'pdf'; data: Uint8Array | ArrayBuffer | Buffer } | { kind: 'image'; data: Uint8Array | Buffer },
  options: PipelineOptions = {},
): Promise<ExtractionResult> {
  const startedAt = options.now?.() ?? Date.now();
  const elapsed = () => (options.now?.() ?? Date.now()) - startedAt;
  const warnings: string[] = [];
  const maxPages = options.maxPages ?? MAX_DOCUMENT_PAGES;
  const maxOcrPages = options.maxOcrPages ?? MAX_OCR_PAGES;
  const ocrMode = options.ocr ?? 'auto';
  const failedPages: { page: number; reason: string }[] = [];

  emit(options.onStage, 'extracting_text', 'Extracting document text', false);

  let pages: string[] = [];
  let totalPages = 1;
  let documentKind: DocumentProcessingReport['documentKind'] = 'unknown';
  const pageMethods = new Map<number, ProcessingPage['method']>();
  const pageConfidence = new Map<number, number>();

  if (input.kind === 'image') {
    documentKind = 'image';
    totalPages = 1;
    if (ocrMode === 'off') {
      return {
        ok: false,
        code: 'IMAGE_OCR_DISABLED',
        message: 'Image reading requires OCR, but OCR is disabled for this request.',
        questions: [],
        totalPages: 1,
        documentKind,
      };
    }
    if (!isOcrAvailable()) {
      return {
        ok: false,
        code: 'IMAGE_OCR_UNAVAILABLE',
        message:
          'Image accepted, but the OCR engine is not available on this server. Upload a text PDF or install the OCR dependencies.',
        questions: [],
        totalPages: 1,
        documentKind,
      };
    }

    emit(options.onStage, 'ocr', 'Reading image with OCR', false, { page: 1, totalPages: 1 });
    try {
      const result = await ocrImage(input.data, { timeoutMs: options.ocrTimeoutMs });
      pages = [result.text];
      pageMethods.set(1, result.text.trim() ? 'ocr' : 'none');
      pageConfidence.set(1, result.confidence);
    } catch (err) {
      const message =
        err instanceof OcrError ? err.message : 'OCR could not read this image.';
      return {
        ok: false,
        code: err instanceof OcrError ? err.code : 'OCR_FAILED',
        message,
        questions: [],
        totalPages: 1,
        documentKind,
      };
    }
    emit(options.onStage, 'ocr', 'Image OCR complete', true, { page: 1, totalPages: 1 });
  } else {
    const analysis = await analyzePdfPages(input.data);
    if (!analysis.ok) {
      return {
        ok: false,
        code: analysis.code,
        message: analysis.message,
        totalPages: analysis.totalPages,
        questions: [],
        documentKind: 'unknown',
      };
    }

    pages = analysis.pages;
    totalPages = analysis.totalPages;

    if (totalPages > maxPages) {
      return {
        ok: false,
        code: 'TOO_MANY_PAGES',
        message: `This PDF has ${totalPages} pages. The limit is ${maxPages} pages per document.`,
        questions: [],
        totalPages,
        documentKind: 'unknown',
      };
    }

    documentKind =
      analysis.emptyPages.length === 0
        ? 'text_pdf'
        : analysis.emptyPages.length === totalPages
          ? 'scanned_pdf'
          : 'mixed_pdf';

    emit(options.onStage, 'extracting_text', 'Document text extracted', true, {
      totalPages,
    });

    const pagesNeedingOcr = analysis.emptyPages;
    if (pagesNeedingOcr.length > 0) {
      if (ocrMode === 'off') {
        for (const page of pagesNeedingOcr) {
          failedPages.push({ page, reason: 'No text layer; OCR was disabled.' });
        }
        warnings.push(
          `${pagesNeedingOcr.length} page(s) have no text layer. Enable OCR to read them.`,
        );
      } else if (!isOcrAvailable()) {
        for (const page of pagesNeedingOcr) {
          failedPages.push({ page, reason: 'No text layer and the OCR engine is unavailable.' });
        }
        warnings.push(
          `${pagesNeedingOcr.length} page(s) have no text layer and OCR is not installed.`,
        );
      } else if (!isPdfRasterisationAvailable()) {
        for (const page of pagesNeedingOcr) {
          failedPages.push({
            page,
            reason: 'No text layer and server-side PDF rasterisation is unavailable.',
          });
        }
        warnings.push(
          `${pagesNeedingOcr.length} page(s) need OCR, but PDF rasterisation is unavailable.`,
        );
      } else if (pagesNeedingOcr.length > maxOcrPages) {
        for (const page of pagesNeedingOcr) {
          failedPages.push({
            page,
            reason: `OCR skipped: ${pagesNeedingOcr.length} pages need OCR, limit is ${maxOcrPages}.`,
          });
        }
        warnings.push(
          `OCR skipped for ${pagesNeedingOcr.length} page(s) because the per-document OCR limit is ${maxOcrPages}.`,
        );
      } else {
        for (const pageNumber of pagesNeedingOcr) {
          emit(options.onStage, 'ocr', `Reading page ${pageNumber} with OCR`, false, {
            page: pageNumber,
            totalPages,
          });
          try {
            const image = await renderPdfPageToPng(input.data, pageNumber, 2);
            const result = await ocrImage(image, { timeoutMs: options.ocrTimeoutMs });
            pages[pageNumber - 1] = result.text;
            pageMethods.set(pageNumber, result.text.trim() ? 'ocr' : 'none');
            pageConfidence.set(pageNumber, result.confidence);
            if (!result.text.trim()) {
              failedPages.push({ page: pageNumber, reason: 'OCR returned no readable text.' });
            }
          } catch (err) {
            const reason =
              err instanceof OcrError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : 'OCR failed.';
            failedPages.push({ page: pageNumber, reason });
          }
          emit(options.onStage, 'ocr', `Page ${pageNumber} OCR finished`, true, {
            page: pageNumber,
            totalPages,
          });
        }
      }
    }
  }

  pages = normalizePages(pages);

  const readablePages = pages.filter((p) => p.replace(/\s+/g, '').length >= 15);
  if (readablePages.length === 0) {
    const message =
      documentKind === 'scanned_pdf'
        ? failedPages.length > 0
          ? 'No readable text could be recovered. OCR was attempted but failed on the scanned page(s).'
          : 'No readable text layer found. This looks like a scanned PDF; OCR is required.'
        : 'No readable text was found in this document.';
    return {
      ok: false,
      code: 'EMPTY_OR_SCANNED',
      message,
      questions: [],
      totalPages,
      documentKind,
      warnings,
    };
  }

  emit(options.onStage, 'detecting_questions', 'Detecting questions and options', false);
  const { questions: parsedQuestions, report: baseReport } = parseExamContent(pages, {
    keepNonMcq: options.keepNonMcq ?? true,
    dedupe: true,
  });
  emit(options.onStage, 'detecting_questions', 'Question reconstruction complete', true);

  emit(options.onStage, 'recovering_answers', 'Recovering answer keys', true);

  let questions = parsedQuestions;
  let solvedCount = 0;
  let disputedCount = 0;
  let aiProposedCount = 0;
  let aiVerifiedCount = 0;
  const aiWarnings: string[] = [];

  if (options.solve && questions.length > 0) {
    emit(options.onStage, 'solving', 'Solving unanswered questions with AI', false);
    try {
      const result = await options.solve(questions);
      questions = result.questions;
      solvedCount = result.solvedCount;
      disputedCount = result.disputedCount;
      aiProposedCount = questions.filter((q) => q.answerStatus === 'ai_proposed').length;
      aiVerifiedCount = questions.filter((q) => q.answerStatus === 'ai_verified').length;
      if (result.warnings?.length) aiWarnings.push(...result.warnings);
      emit(options.onStage, 'solving', 'AI solving complete', true);
      emit(options.onStage, 'verifying', 'Answer verification complete', true);
    } catch (err) {
      aiWarnings.push(
        err instanceof Error
          ? `AI solving stopped: ${err.message}`
          : 'AI solving stopped unexpectedly.',
      );
      emit(options.onStage, 'solving', 'AI solving stopped', true);
    }
  }

  emit(options.onStage, 'preparing', 'Preparing exam and report', false);

  const processingPages: ProcessingPage[] = pages.map((text, idx) => {
    const pageNumber = idx + 1;
    const method = pageMethods.get(pageNumber) ?? (text.replace(/\s+/g, '').length > 0 ? 'text' : 'none');
    const pageReport = baseReport.pages?.find((p) => p.pageNumber === pageNumber);
    return {
      pageNumber,
      textLength: text.replace(/\s+/g, '').length,
      questionCount: pageReport?.questionCount ?? 0,
      method,
      ...(pageConfidence.has(pageNumber) ? { ocrConfidence: pageConfidence.get(pageNumber) } : {}),
      ...(failedPages.find((f) => f.page === pageNumber)
        ? { warning: failedPages.find((f) => f.page === pageNumber)!.reason }
        : {}),
    };
  });

  const report = mergeReport(baseReport, processingPages, {
    documentKind,
    totalPages,
    extractedCount: questions.length,
    officialAnswerCount: questions.filter((q) => q.answerStatus === 'official_answer' || q.answerStatus === 'user_confirmed').length,
    aiSolvedCount: solvedCount,
    aiProposedCount,
    aiVerifiedCount,
    disputedCount,
    needsReviewCount: questions.filter((q) => q.answerStatus === 'needs_review').length,
    unkeyedCount: questions.filter(
      (q) => !q.hasKnownAnswer && q.answerStatus !== 'ai_proposed' && q.answerStatus !== 'ai_verified',
    ).length,
    failedPages,
    warnings: [...warnings, ...aiWarnings, ...(baseReport.warnings ?? [])],
    durationMs: elapsed(),
  });

  emit(options.onStage, 'preparing', 'Exam ready', true);
  emit(options.onStage, 'done', 'Processing complete', true);

  return {
    ok: true,
    totalPages,
    documentKind,
    questions,
    report,
    textPreview: pages.join('\n\n').slice(0, 500),
    pages: processingPages,
    ocrUsed: report.ocrUsed,
    warnings: report.warnings,
  };
}

/** Small helper used by the API to keep text-PDF extraction and pipeline in sync. */
export async function processPdfTextOnly(
  data: Uint8Array | ArrayBuffer | Buffer,
  options: Omit<PipelineOptions, 'solve'> = {},
): Promise<ExtractionResult> {
  return processDocument({ kind: 'pdf', data }, { ...options, ocr: options.ocr ?? 'off' });
}

/** Re-exported for tests that need to assert the low-level extractor still works. */
export { extractPdfText };
