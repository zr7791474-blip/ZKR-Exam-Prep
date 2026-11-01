import { getProvider, getVerifierProvider } from '../../../lib/ai/provider';
import { solveQuestions } from '../../../lib/ai/solve-question';
import { processDocument } from '../../../lib/extraction/pipeline';
import { enforceRateLimit } from '../../../lib/security/limits';
import {
  MAX_UPLOAD_BYTES,
  SIGNATURE_BYTES,
  sanitizeFileName,
  validateFile,
  type ValidationErrorCode,
} from '../../../lib/validation/file';

export const runtime = 'nodejs';

const MULTIPART_OVERHEAD = 64 * 1024;
const STATUS: Record<ValidationErrorCode, number> = {
  EMPTY: 400,
  TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
};

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

function isOn(value: FormDataEntryValue | null): boolean {
  return ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

/**
 * Validates an uploaded exam and runs the full extraction pipeline:
 * text extraction, page OCR fallback, page-aware question reconstruction,
 * answer-key recovery, and optional AI solving.
 *
 * Uploads always succeed when the file is valid, even if extraction fails; the
 * response reports the real failure instead of pretending content was found.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, 'upload');
  if (!limited.allowed) return limited.response!;

  try {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
      return fail(413, 'TOO_LARGE', 'File is too large.');
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return fail(400, 'INVALID_BODY', 'Send the file as multipart form data.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) return fail(400, 'NO_FILE', 'No file was provided.');

    const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
    const validation = validateFile({ size: file.size, head });
    if (!validation.ok) {
      return fail(STATUS[validation.code], validation.code, validation.message);
    }

    const safeName = sanitizeFileName(file.name);
    const document = { name: safeName, mime: validation.mime, size: file.size };
    const ocr = isOn(form.get('ocr_off')) ? 'off' : 'auto';
    const wantsSolve = isOn(form.get('solve'));
    const bytes = new Uint8Array(await file.arrayBuffer());

    const provider = wantsSolve ? getProvider() : null;
    const warnings: string[] = [];
    if (wantsSolve && !provider) {
      warnings.push(
        'AI solving was requested but no AI provider is configured. Add AI_PROVIDER and an API key to enable it.',
      );
    }

    const extraction = await processDocument(
      validation.mime === 'application/pdf'
        ? { kind: 'pdf', data: bytes }
        : { kind: 'image', data: bytes },
      {
        ocr,
        keepNonMcq: true,
        ...(provider
          ? {
              solve: async (questions) => {
                const solved = await solveQuestions(questions, {
                  provider,
                  verifier: getVerifierProvider(),
                  maxQuestions: 30,
                  concurrency: 3,
                });
                return {
                  questions: solved.questions,
                  solvedCount: solved.solvedCount,
                  disputedCount: solved.disputedCount,
                  verifiedCount: solved.verifiedCount,
                  warnings: solved.warnings,
                };
              },
            }
          : {}),
      },
    );

    const questions = extraction.questions ?? [];
    const allWarnings = [...warnings, ...(extraction.warnings ?? [])];

    return Response.json({
      document,
      extraction: {
        ok: extraction.ok,
        code: extraction.code,
        message: extraction.message,
        totalPages: extraction.totalPages,
        documentKind: extraction.documentKind,
        textPreview: extraction.textPreview,
        questions,
        questionCount: questions.length,
        knownAnswerCount: questions.filter((q) => q.hasKnownAnswer).length,
        report: extraction.report,
        pages: extraction.pages,
        ocrUsed: extraction.ocrUsed ?? false,
        warnings: allWarnings,
        aiConfigured: Boolean(provider),
      },
    });
  } catch {
    return fail(500, 'INTERNAL', 'Something went wrong. Please try again.');
  }
}
