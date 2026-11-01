import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  detectMime,
  formatBytes,
  sanitizeFileName,
  validateFile,
} from './file';

function bytes(...b: number[]): Uint8Array {
  return new Uint8Array(b);
}
function ascii(s: string): Uint8Array {
  return new Uint8Array([...s].map((c) => c.charCodeAt(0)));
}

describe('detectMime', () => {
  it('recognises PDF', () => {
    expect(detectMime(ascii('%PDF-1.7'))).toBe('application/pdf');
  });
  it('recognises PNG', () => {
    expect(detectMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
  });
  it('recognises JPEG', () => {
    expect(detectMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });
  it('recognises WebP', () => {
    expect(detectMime(new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), 0, 0]))).toBe('image/webp');
  });
  it('rejects unknown', () => {
    expect(detectMime(ascii('hello'))).toBeNull();
    expect(detectMime(ascii('<!DOCTYPE'))).toBeNull();
  });
});

describe('validateFile', () => {
  it('accepts PDF up to limit', () => {
    const res = validateFile({ size: 1024, head: ascii('%PDF-1.4') });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.mime).toBe('application/pdf');
  });
  it('rejects empty', () => {
    const res = validateFile({ size: 0, head: ascii('%PDF-') });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('EMPTY');
  });
  it('rejects over limit', () => {
    const res = validateFile({ size: MAX_UPLOAD_BYTES + 1, head: ascii('%PDF-') });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('TOO_LARGE');
  });
  it('accepts exactly at limit', () => {
    const res = validateFile({ size: MAX_UPLOAD_BYTES, head: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) });
    expect(res.ok).toBe(true);
  });
  it('rejects unsupported', () => {
    const res = validateFile({ size: 100, head: ascii('GIF89a') });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('UNSUPPORTED_TYPE');
  });
});

describe('formatBytes', () => {
  it('formats KB and MB', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});

describe('sanitizeFileName', () => {
  it('strips paths', () => {
    expect(sanitizeFileName('C:\\\\temp\\\\exam.pdf')).toBe('exam.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
  });
  it('removes control chars and truncates', () => {
    const long = 'a'.repeat(200) + '.pdf';
    const s = sanitizeFileName(long);
    expect(s.length).toBeLessThanOrEqual(120);
  });
  it('falls back for empty', () => {
    expect(sanitizeFileName('')).toBe('untitled');
  });
});
