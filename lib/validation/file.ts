/** Upload limit (10 MB). Change here; the client and the server both import it. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Number of leading bytes needed to recognise every supported format. */
export const SIGNATURE_BYTES = 12;

export type AllowedMime = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
export type ValidationErrorCode = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE';
export type ValidationResult =
  | { ok: true; mime: AllowedMime }
  | { ok: false; code: ValidationErrorCode; message: string };

export function formatBytes(n: number): string {
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function startsWith(head: Uint8Array, offset: number, bytes: number[]): boolean {
  return bytes.every((b, i) => head[offset + i] === b);
}
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Detects the real type from the file signature. Filename and client MIME are never used. */
export function detectMime(head: Uint8Array): AllowedMime | null {
  if (startsWith(head, 0, ascii('%PDF-'))) return 'application/pdf';
  if (startsWith(head, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(head, 0, ascii('RIFF')) && startsWith(head, 8, ascii('WEBP'))) return 'image/webp';
  return null;
}

export function validateFile(
  input: { size: number; head: Uint8Array },
  maxBytes: number = MAX_UPLOAD_BYTES,
): ValidationResult {
  if (input.size === 0) return { ok: false, code: 'EMPTY', message: 'This file is empty.' };
  if (input.size > maxBytes) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: `File is ${formatBytes(input.size)}. The limit is ${formatBytes(maxBytes)}.`,
    };
  }
  const mime = detectMime(input.head);
  if (!mime) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      message: 'Unsupported or corrupted file. Use a real PDF, JPG, PNG or WebP.',
    };
  }
  return { ok: true, mime };
}

/** Strips paths, control characters and excess length. For display only; never used as a storage path. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
   
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return clean || 'untitled';
}
