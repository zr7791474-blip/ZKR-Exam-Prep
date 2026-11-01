'use client';

import React, { useEffect, useRef, useState, type DragEvent } from 'react';
import type {
  DocumentProcessingReport,
  Exam,
  ProcessingPage,
  Question,
} from '../lib/models/exam';
import {
  MAX_UPLOAD_BYTES,
  SIGNATURE_BYTES,
  formatBytes,
  validateFile,
  type AllowedMime,
} from '@/lib/validation/file';
import { ProcessingReport } from './ProcessingReport';
import {
  IconUpload,
  IconDocument,
  IconCheckCircle,
  IconAlertTriangle,
  IconRotateCw,
} from './ui/icons';
import { useToast } from './ui/Toast';

interface UploadResponse {
  document: { name: string; mime: AllowedMime; size: number };
  extraction?: {
    ok: boolean;
    code?: string;
    message?: string;
    totalPages?: number;
    documentKind?: DocumentProcessingReport['documentKind'];
    textPreview?: string;
    questions?: Question[];
    questionCount?: number;
    knownAnswerCount?: number;
    report?: DocumentProcessingReport;
    pages?: ProcessingPage[];
    ocrUsed?: boolean;
    warnings?: string[];
    aiConfigured?: boolean;
  };
  error?: { message?: string };
}

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progressStep?: string }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      name: string;
      size: number;
      mime: AllowedMime;
      url: string;
      extractionMessage: string;
      questionCount: number;
      failed: boolean;
      report?: DocumentProcessingReport;
      warnings: string[];
      documentKind?: DocumentProcessingReport['documentKind'];
    };

interface UploadZoneProps {
  onExamLoaded?: (exam: Exam) => void;
  onNavigateToReview?: () => void;
}

export function UploadZone({ onExamLoaded, onNavigateToReview }: UploadZoneProps) {
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [useOcr, setUseOcr] = useState(true);
  const [useAi, setUseAi] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const urlRef = useRef<string | null>(null);
  const { success, error: toastError, warning: toastWarn } = useToast();

  const revoke = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };
  useEffect(() => revoke, []);

  async function handle(file: File | undefined) {
    if (!file || busy.current) return;
    busy.current = true;
    setState({ status: 'uploading', progressStep: 'Validating file signature & reading header...' });

    try {
      const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
      const local = validateFile({ size: file.size, head });
      if (!local.ok) throw new Error(local.message);

      setState({
        status: 'uploading',
        progressStep: useOcr
          ? 'Reading text layer & preparing Tesseract OCR...'
          : 'Extracting structured text pages...',
      });

      const body = new FormData();
      body.append('file', file);
      if (!useOcr) body.append('ocr_off', '1');
      if (useAi) body.append('solve', '1');

      const res = await fetch('/api/documents', { method: 'POST', body });
      const data: UploadResponse | null = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Upload failed. Please try again.');
      }

      revoke();
      urlRef.current = URL.createObjectURL(new Blob([file], { type: local.mime }));

      const extraction = data?.extraction;
      const questions = extraction?.questions ?? [];
      const report = extraction?.report;
      const warnings = extraction?.warnings ?? [];
      const failed = !extraction?.ok;

      let extractionMessage: string;
      if (!extraction) {
        extractionMessage = 'File accepted, but the server did not return an extraction result.';
        toastWarn('File accepted without extraction details');
      } else if (failed) {
        extractionMessage =
          extraction.message || 'The file was accepted but no text could be extracted.';
        toastError(extractionMessage);
      } else if (questions.length > 0) {
        const known = extraction.knownAnswerCount ?? 0;
        const aiCount = report?.aiProposedCount ?? 0;
        extractionMessage = `Extracted ${questions.length} question(s) from ${
          extraction.totalPages ?? 1
        } page(s); ${known} with verified answers${
          aiCount > 0 ? `, ${aiCount} AI proposal(s)` : ''
        }.`;
        success(`Successfully processed ${questions.length} questions from ${file.name}`);
      } else {
        extractionMessage = `Text was read from ${
          extraction.totalPages ?? 1
        } page(s), but no questions matched a recognized format. Check the diagnostic report below.`;
        toastWarn('No questions detected in the uploaded document');
      }

      if (questions.length > 0 && extraction?.ok) {
        const exam: Exam = {
          id: `exam-${Date.now()}`,
          title: file.name.replace(/\.[^/.]+$/, ''),
          sourceFileName: file.name,
          uploadedAt: new Date().toISOString(),
          questions,
          totalPages: extraction.totalPages,
          rawTextPreview: extraction.textPreview,
          ...(report ? { processingReport: report } : {}),
          documentKind: extraction.documentKind ?? report?.documentKind,
        };
        onExamLoaded?.(exam);
      }

      setState({
        status: 'ready',
        name: file.name,
        size: file.size,
        mime: local.mime,
        url: urlRef.current,
        extractionMessage,
        questionCount: questions.length,
        failed,
        ...(report ? { report } : {}),
        warnings,
        documentKind: extraction?.documentKind ?? report?.documentKind,
      });
    } catch (e) {
      revoke();
      const msg = e instanceof Error ? e.message : 'Upload failed.';
      setState({ status: 'error', message: msg });
      toastError(msg);
    } finally {
      busy.current = false;
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 1) {
      setState({ status: 'error', message: 'Please drop one file at a time.' });
      return;
    }
    void handle(e.dataTransfer.files[0]);
  }

  const uploading = state.status === 'uploading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <section
        className={`drop${dragging ? ' over' : ''}`}
        aria-labelledby="uploadTitle"
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={onDrop}
      >
        <h2 id="uploadTitle" className="sr">
          Upload an educational document or exam
        </h2>

        <div className="drop-icon-wrap">
          {uploading ? (
            <IconRotateCw size={28} className="animate-spin" />
          ) : (
            <IconUpload size={28} />
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
          <strong style={{ fontSize: '18px', color: 'var(--text-primary)' }}>
            {uploading ? 'Processing document...' : 'Upload your exam, worksheet, or lecture PDF'}
          </strong>
          <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--text-secondary)' }}>
            Drag & drop here or choose from your computer. Supports <strong>PDF, PNG, JPG, WebP</strong> (up to {formatBytes(MAX_UPLOAD_BYTES)}).
          </p>
        </div>

        {/* Engine options */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'center',
            padding: '12px 18px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            maxWidth: '680px',
            width: '100%',
          }}
        >
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={useOcr}
              disabled={uploading}
              onChange={(e) => setUseOcr(e.target.checked)}
              style={{ accentColor: 'var(--accent-primary)' }}
            />
            <span>
              <strong>OCR Engine:</strong> Extract scanned pages with offline Tesseract
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px' }}>
            <input
              type="checkbox"
              checked={useAi}
              disabled={uploading}
              onChange={(e) => setUseAi(e.target.checked)}
              style={{ accentColor: 'var(--accent-primary)' }}
            />
            <span>
              <strong>AI Solver:</strong> Propose answers for unkeyed items (optional)
            </span>
          </label>
        </div>

        <button
          className="btn primary lg"
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <>
              <IconRotateCw size={18} className="animate-spin" /> Analyzing Document...
            </>
          ) : (
            <>
              <IconDocument size={18} /> Select Exam File
            </>
          )}
        </button>

        <input
          ref={inputRef}
          className="sr"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          tabIndex={-1}
          aria-label="Choose exam file"
          onChange={(e) => void handle(e.target.files?.[0])}
        />

        {/* Status Message */}
        {uploading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--accent-text)',
              fontSize: '13.5px',
              fontWeight: 500,
            }}
          >
            <span>{state.progressStep}</span>
          </div>
        )}

        {state.status === 'error' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--status-err-text)',
              fontSize: '13.5px',
              background: 'var(--status-err-bg)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--status-err-border)',
            }}
          >
            <IconAlertTriangle size={16} />
            <span>{state.message}</span>
          </div>
        )}

        {state.status === 'ready' && !state.failed && state.questionCount > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              color: 'var(--status-ok-text)',
              fontSize: '13.5px',
              background: 'var(--status-ok-bg)',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--status-ok-border)',
            }}
          >
            <IconCheckCircle size={16} />
            <span>{state.extractionMessage}</span>
          </div>
        )}
      </section>

      {/* Ready document details & preview */}
      {state.status === 'ready' && (
        <div className="file show">
          <div className="meta">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <IconDocument size={20} style={{ color: 'var(--accent-text)' }} />
              <div>
                <strong>{state.name}</strong>
                <span style={{ color: 'var(--text-secondary)', marginLeft: '8px', fontSize: '13px' }}>
                  ({formatBytes(state.size)})
                </span>
                {state.documentKind && (
                  <span className="badge" style={{ marginLeft: '10px' }}>
                    {state.documentKind.replace('_', ' ')}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {state.questionCount > 0 && onNavigateToReview && (
                <button className="btn primary sm" onClick={onNavigateToReview}>
                  Review Questions ({state.questionCount})
                </button>
              )}
              <button className="btn secondary sm" onClick={() => inputRef.current?.click()}>
                Replace File
              </button>
              <button
                className="btn ghost sm"
                onClick={() => {
                  revoke();
                  setState({ status: 'idle' });
                }}
              >
                Clear
              </button>
            </div>
          </div>

          {state.report && <ProcessingReport report={state.report} />}

          {state.warnings.length > 0 && !state.report && (
            <ul className="report-list" style={{ background: 'var(--bg-surface)', padding: '16px', borderRadius: 'var(--radius-md)' }}>
              {state.warnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          )}

          {/* Inline Document Preview */}
          <div style={{ marginTop: '8px' }}>
            <h4 style={{ fontSize: '14px', marginBottom: '8px', color: 'var(--text-secondary)' }}>
              Document Visual Preview
            </h4>
            {state.mime === 'application/pdf' ? (
              <object
                className="preview"
                data={state.url}
                type="application/pdf"
                aria-label="PDF preview"
              >
                <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  Your browser does not support inline PDF preview. The document was successfully loaded and extracted into memory.
                </div>
              </object>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="preview" src={state.url} alt={`Preview of ${state.name}`} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
