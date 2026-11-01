import { describe, expect, it } from 'vitest';
import { extractPdfText } from './pdf';

const sampleTextPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 68>>stream
BT /F1 12 Tf 100 700 Td (1. What is React? A\\) Library B\\) Framework) Tj ET
endstream
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000212 00000 n 
0000000289 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
408
%%EOF`;

const scannedImagePdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj
4 0 obj<</Length 0>>stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000056 00000 n 
0000000111 00000 n 
0000000192 00000 n 
trailer<</Size 5/Root 1 0 R>>
startxref
243
%%EOF`;

const encryptedPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj
4 0 obj<</Filter/Standard/V 1/R 2/O (12345678901234567890123456789012)/U (12345678901234567890123456789012)/P -4>>endobj
trailer<</Size 5/Root 1 0 R/Encrypt 4 0 R>>
startxref
190
%%EOF`;

describe('extractPdfText', () => {
  it('extracts readable text from standard text PDF', async () => {
    const bytes = new Uint8Array(Buffer.from(sampleTextPdf));
    const result = await extractPdfText(bytes);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalPages).toBe(1);
      expect(result.text).toContain('What is React?');
    }
  });

  it('rejects empty input', async () => {
    const result = await extractPdfText(new Uint8Array(0));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('EMPTY');
    }
  });

  it('detects scanned / image-only PDFs with no text layer', async () => {
    const bytes = new Uint8Array(Buffer.from(scannedImagePdf));
    const result = await extractPdfText(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('EMPTY_OR_SCANNED');
      expect(result.message.toLowerCase()).toContain('ocr');
    }
  });

  it('handles encrypted / password-protected PDFs', async () => {
    const bytes = new Uint8Array(Buffer.from(encryptedPdf));
    const result = await extractPdfText(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ENCRYPTED');
    }
  });

  it('handles corrupted / malformed PDF structures', async () => {
    const corrupted = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x00, 0xff, 0xfe]);
    const result = await extractPdfText(corrupted);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('MALFORMED');
    }
  });
});
