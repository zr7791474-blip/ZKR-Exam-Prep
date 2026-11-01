'use client';

import type { DocumentProcessingReport } from '../lib/models/exam';
import {
  IconAlertTriangle,
  IconDocument,
} from './ui/icons';

interface ProcessingReportProps {
  report: DocumentProcessingReport;
  compact?: boolean;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="report-stat">
      <span className="report-stat-value" style={tone ? { color: tone } : undefined}>
        {value}
      </span>
      <span className="report-stat-label">{label}</span>
    </div>
  );
}

/**
 * Shows the transparent, complete extraction result, including pages that failed,
 * suspicious content, duplicates, and anything that needs manual review.
 */
export function ProcessingReport({ report, compact = false }: ProcessingReportProps) {
  const warnings = report.warnings ?? [];
  const failedPages = report.failedPages ?? [];
  const pages = report.pages ?? [];

  return (
    <section className="card" aria-label="Document processing diagnostic report" style={{ padding: '20px', background: 'var(--bg-surface)' }}>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <IconDocument size={18} style={{ color: 'var(--accent-text)' }} />
          <strong style={{ fontSize: '15px' }}>Extraction & Diagnostic Report</strong>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span className="badge accent">
            {report.documentKind?.replace('_', ' ') ?? 'document'}
          </span>
          {report.ocrUsed && <span className="badge ok">OCR Processed</span>}
          {report.aiConfigured === false && <span className="badge warn">AI Offline</span>}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="report-grid">
        <Stat label="Pages Processed" value={report.totalPages} />
        <Stat label="Extracted Qs" value={report.extractedCount} />
        <Stat label="Official Keys" value={report.officialAnswerCount} tone="var(--status-ok-text)" />
        <Stat label="AI Proposed" value={report.aiProposedCount ?? 0} tone="var(--status-warn-text)" />
        <Stat label="AI Verified" value={report.aiVerifiedCount ?? 0} tone="var(--status-ok-text)" />
        <Stat label="Disputed" value={report.disputedCount} tone="var(--status-err-text)" />
        <Stat label="Needs Review" value={report.needsReviewCount} tone="var(--status-warn-text)" />
        <Stat label="Unkeyed" value={report.unkeyedCount} />
        {typeof report.durationMs === 'number' && (
          <Stat label="Duration" value={`${(report.durationMs / 1000).toFixed(1)}s`} />
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div style={{ marginTop: '14px', background: 'var(--bg-subtle)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--status-warn-text)', marginBottom: '6px' }}>
            <IconAlertTriangle size={15} />
            <strong style={{ fontSize: '13px' }}>Warnings & Edge Cases</strong>
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {warnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Failed pages */}
      {failedPages.length > 0 && (
        <div style={{ marginTop: '12px', background: 'var(--status-err-bg)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--status-err-border)' }}>
          <strong style={{ fontSize: '13px', color: 'var(--status-err-text)', display: 'block', marginBottom: '6px' }}>
            Pages that could not be read
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {failedPages.map((page) => (
              <li key={page.page}>
                Page {page.page}: {page.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Suspicious pages */}
      {report.suspiciousPages.length > 0 && (
        <div style={{ marginTop: '12px', background: 'var(--bg-subtle)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <strong style={{ fontSize: '13px', color: 'var(--status-warn-text)', display: 'block', marginBottom: '6px' }}>
            Suspicious pages (possible unparsed questions)
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {report.suspiciousPages.map((page) => (
              <li key={page.page}>
                Page {page.page}: {page.reason} — &ldquo;{page.textSnippet}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Malformed questions */}
      {report.malformedQuestions.length > 0 && (
        <div style={{ marginTop: '12px', background: 'var(--bg-subtle)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <strong style={{ fontSize: '13px', color: 'var(--status-warn-text)', display: 'block', marginBottom: '6px' }}>
            Questions needing review or repair
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {report.malformedQuestions.map((item, index) => (
              <li key={`${item.index}-${index}`}>
                Item {item.index}: {item.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Duplicates */}
      {report.potentialDuplicates.length > 0 && (
        <div style={{ marginTop: '12px', background: 'var(--bg-subtle)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <strong style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block', marginBottom: '6px' }}>
            Potential duplicate questions
          </strong>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {report.potentialDuplicates.map((dupe, index) => (
              <li key={`${dupe.q1Index}-${dupe.q2Index}-${index}`}>
                Questions {dupe.q1Index} and {dupe.q2Index}: &ldquo;{dupe.prompt}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Page-by-page table */}
      {!compact && pages.length > 0 && (
        <details style={{ marginTop: '14px', fontSize: '13px' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--accent-text)' }}>
            View Page-by-Page Extraction Log ({pages.length} pages)
          </summary>
          <div style={{ overflowX: 'auto', marginTop: '10px' }}>
            <table className="report-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 10px' }}>Page</th>
                  <th style={{ padding: '8px 10px' }}>Engine Method</th>
                  <th style={{ padding: '8px 10px' }}>Extracted Characters</th>
                  <th style={{ padding: '8px 10px' }}>Questions</th>
                  <th style={{ padding: '8px 10px' }}>Diagnostics</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((page) => (
                  <tr key={page.pageNumber}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{page.pageNumber}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span className="badge sm">
                        {page.method === 'ocr' ? 'Tesseract OCR' : page.method === 'text' ? 'Native Text Layer' : 'None'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>{page.textLength.toLocaleString()}</td>
                    <td style={{ padding: '8px 10px' }}>{page.questionCount}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-secondary)' }}>
                      {typeof page.ocrConfidence === 'number'
                        ? `OCR Confidence: ${page.ocrConfidence.toFixed(0)}%. `
                        : ''}
                      {page.warning ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
