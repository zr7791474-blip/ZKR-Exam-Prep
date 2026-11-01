import { describe, expect, it } from 'vitest';
import { processDocument } from './pipeline';

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

function bytes(pdf: string): Uint8Array {
  return new Uint8Array(Buffer.from(pdf));
}

describe('processDocument', () => {
  it('extracts page-aware questions and a complete report from a text PDF', async () => {
    const result = await processDocument({ kind: 'pdf', data: bytes(sampleExamPdf) });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].prompt).toContain('Capital of UK?');
    expect(result.questions[0].pageNumber).toBe(1);
    expect(result.questions[0].answerStatus).toBe('official_answer');
    expect(result.documentKind).toBe('text_pdf');
    expect(result.report?.totalPages).toBe(1);
    expect(result.report?.extractedCount).toBe(1);
    expect(result.report?.officialAnswerCount).toBe(1);
    expect(result.report?.pages?.[0]).toMatchObject({
      pageNumber: 1,
      method: 'text',
      questionCount: 1,
    });
  });

  it('reports scanned pages honestly when OCR is disabled', async () => {
    const result = await processDocument(
      { kind: 'pdf', data: bytes(scannedPdf) },
      { ocr: 'off' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('EMPTY_OR_SCANNED');
    expect(result.documentKind).toBe('scanned_pdf');
    expect(result.questions).toEqual([]);
    expect(result.warnings?.join(' ')).toMatch(/OCR/i);
  });

  it('refuses documents above the page limit', async () => {
    const result = await processDocument(
      { kind: 'pdf', data: bytes(sampleExamPdf) },
      { maxPages: 0 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOO_MANY_PAGES');
    expect(result.message).toContain('limit');
  });

  it('does not attempt OCR for images when OCR is disabled', async () => {
    const result = await processDocument(
      { kind: 'image', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
      { ocr: 'off' },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('IMAGE_OCR_DISABLED');
  });

  it('runs the AI solving hook and records its real counts and warnings', async () => {
    const stages: string[] = [];
    const result = await processDocument(
      { kind: 'pdf', data: bytes(sampleExamPdf) },
      {
        onStage: (event) => stages.push(event.stage),
        solve: async (questions) => ({
          questions: questions.map((question) => ({
            ...question,
            hasKnownAnswer: false,
            answerStatus: 'ai_proposed' as const,
            verificationLevel: 2 as const,
          })),
          solvedCount: questions.length,
          disputedCount: 0,
          verifiedCount: 0,
          warnings: ['mocked solve warning'],
        }),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report?.aiProposedCount).toBe(1);
    expect(result.report?.officialAnswerCount).toBe(0);
    expect(result.report?.aiSolvedCount).toBe(1);
    expect(result.warnings).toContain('mocked solve warning');
    expect(stages).toEqual(expect.arrayContaining(['solving', 'verifying', 'preparing', 'done']));
  });
});
