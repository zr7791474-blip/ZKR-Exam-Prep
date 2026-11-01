import { describe, expect, it } from 'vitest';
import { POST } from './route';

const sampleExamPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 70>>stream
BT /F1 12 Tf 100 700 Td (1. Capital of UK? A\\) London B\\) Paris Ans: A) Tj ET
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
410
%%EOF`;

const scannedPdf = `%PDF-1.4
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

function makeForm(file: File, fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append('file', file);
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

function pdfFile(name = 'exam.pdf', bytesArr: number[] = [0x25, 0x50, 0x44, 0x46, 0x2d]): File {
  return new File([new Uint8Array(bytesArr)], name, { type: 'application/pdf' });
}

function pngFile(name = 'img.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
    type: 'image/png',
  });
}

describe('POST /api/documents', () => {
  it('accepts a minimal PDF header', async () => {
    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: makeForm(pdfFile()),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.document.mime).toBe('application/pdf');
  });

  it('extracts questions from a valid text PDF', async () => {
    const bytes = new Uint8Array(Buffer.from(sampleExamPdf));
    const file = new File([bytes], 'sample-exam.pdf', { type: 'application/pdf' });
    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: makeForm(file),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extraction.ok).toBe(true);
    expect(json.extraction.questionCount).toBe(1);
    expect(json.extraction.questions[0].prompt).toContain('Capital of UK?');
    expect(json.extraction.questions[0].hasKnownAnswer).toBe(true);
    expect(json.extraction.questions[0].answerStatus).toBe('official_answer');
    expect(json.extraction.questions[0].pageNumber).toBe(1);
    expect(json.extraction.report.totalPages).toBe(1);
    expect(json.extraction.documentKind).toBe('text_pdf');
  });

  it('reports scanned image PDFs as needing OCR without claiming OCR works', async () => {
    const bytes = new Uint8Array(Buffer.from(scannedPdf));
    const file = new File([bytes], 'scanned.pdf', { type: 'application/pdf' });
    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: makeForm(file, { ocr_off: '1' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extraction.ok).toBe(false);
    expect(json.extraction.code).toBe('EMPTY_OR_SCANNED');
    expect(json.extraction.message.toLowerCase()).toContain('ocr');
    expect(json.extraction.questions).toEqual([]);
  });

  it('reports an unreadable image honestly instead of pretending OCR succeeded', async () => {
    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: makeForm(pngFile()),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.extraction.ok).toBe(false);
    expect(['OCR_FAILED', 'IMAGE_OCR_UNAVAILABLE']).toContain(json.extraction.code);
    expect(json.extraction.questions).toEqual([]);
  });

  it('rejects a renamed text file', async () => {
    const f = new File([new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f])], 'notes.txt', {
      type: 'text/plain',
    });
    const req = new Request('http://localhost/api/documents', { method: 'POST', body: makeForm(f) });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });

  it('rejects empty file', async () => {
    const f = new File([new Uint8Array([])], 'empty.pdf', { type: 'application/pdf' });
    const req = new Request('http://localhost/api/documents', { method: 'POST', body: makeForm(f) });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects missing file', async () => {
    const fd = new FormData();
    const req = new Request('http://localhost/api/documents', { method: 'POST', body: fd });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects non-multipart', async () => {
    const req = new Request('http://localhost/api/documents', { method: 'POST', body: 'x' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
