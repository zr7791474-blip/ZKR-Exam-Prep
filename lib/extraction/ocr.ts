import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { repairOcrOptionSpacing } from './text';

export type OcrErrorCode = 'OCR_UNAVAILABLE' | 'OCR_TIMEOUT' | 'OCR_FAILED';

export class OcrError extends Error {
  code: OcrErrorCode;

  constructor(code: OcrErrorCode, message: string) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
  }
}

export interface OcrResult {
  text: string;
  confidence: number;
  usedBundledLanguageData: boolean;
}

export interface OcrOptions {
  /** Hard timeout in milliseconds for a single page/image. */
  timeoutMs?: number;
  lang?: string;
}

const DEFAULT_TIMEOUT_MS = 90_000;
const require = createRequire(import.meta.url);

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
// Tesseract workers are stateful; serialise calls to avoid cross-page corruption.
let queue: Promise<unknown> = Promise.resolve();

function resolveBundledLanguageData(): string | null {
  try {
    const pkg = require.resolve('@tesseract.js-data/eng/package.json');
    const dir = path.join(path.dirname(pkg), '4.0.0_best_int');
    if (fs.existsSync(path.join(dir, 'eng.traineddata.gz'))) return dir;
  } catch {
    // fall through to workspace lookup
  }

  const fallback = path.join(
    process.cwd(),
    'node_modules',
    '@tesseract.js-data',
    'eng',
    '4.0.0_best_int',
  );
  return fs.existsSync(path.join(fallback, 'eng.traineddata.gz')) ? fallback : null;
}

/** Returns true when both the OCR engine and a rasteriser are importable. */
export function isOcrAvailable(): boolean {
  try {
    require.resolve('tesseract.js');
    return true;
  } catch {
    return false;
  }
}

/** Returns true when server-side PDF page rasterisation is available. */
export function isPdfRasterisationAvailable(): boolean {
  try {
    require.resolve('@napi-rs/canvas');
    return true;
  } catch {
    return false;
  }
}

async function getWorker(lang: string) {
  if (!isOcrAvailable()) {
    throw new OcrError('OCR_UNAVAILABLE', 'OCR engine is not installed on the server.');
  }

  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const langPath = resolveBundledLanguageData() ?? undefined;
      const cachePath = path.join(os.tmpdir(), 'zkr-tesseract-cache');
      try {
        fs.mkdirSync(cachePath, { recursive: true });
      } catch {
        // Non-fatal: tesseract falls back to its default cache location.
      }
      return createWorker(lang, 1, {
        ...(langPath ? { langPath, gzip: true } : {}),
        cachePath,
        logger: () => {
          // Progress is intentionally not streamed to clients (no fabricated UI).
        },
        // Tesseract re-throws job rejections from its message handler unless an
        // error handler is supplied. The rejection still reaches `recognize()`,
        // which is where we handle it; this prevents an unhandled exception.
        errorHandler: () => undefined,
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }

  return workerPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OcrError('OCR_TIMEOUT', 'OCR timed out.')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Runs real OCR on an image buffer (PNG/JPEG/WebP) or a rasterised PDF page.
 * The engine is Tesseract.js; language data is loaded from the bundled npm
 * package when present, otherwise Tesseract downloads it from its CDN.
 */
export async function ocrImage(
  image: Uint8Array | Buffer,
  options: OcrOptions = {},
): Promise<OcrResult> {
  const lang = options.lang ?? 'eng';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const bundled = resolveBundledLanguageData() !== null;

  const run = async (): Promise<OcrResult> => {
    const worker = await withTimeout(getWorker(lang), timeoutMs);
    const result = await withTimeout(worker.recognize(Buffer.from(image)), timeoutMs);
    const rawText = result?.data?.text ?? '';
    const confidence = Number(result?.data?.confidence ?? 0);
    return {
      text: repairOcrOptionSpacing(rawText).replace(/\r\n?/g, '\n'),
      confidence: Number.isFinite(confidence) ? confidence : 0,
      usedBundledLanguageData: bundled,
    };
  };

  const task = queue.then(run, run);
  // Keep the queue alive even when a page fails.
  queue = task.catch(() => undefined);

  try {
    return await task;
  } catch (err) {
    if (err instanceof OcrError) throw err;
    throw new OcrError('OCR_FAILED', 'OCR could not read this page.');
  }
}

/** Terminates the shared worker. Used by tests and graceful shutdown. */
export async function terminateOcr(): Promise<void> {
  if (!workerPromise) return;
  const pending = workerPromise;
  workerPromise = null;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Worker failed to start; nothing to terminate.
  }
}
