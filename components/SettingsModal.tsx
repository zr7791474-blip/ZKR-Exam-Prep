'use client';

import React, { useState } from 'react';
import type { AICapabilityStatus } from '@/lib/models/exam';
import {
  IconSettings,
  IconShield,
  IconX,
  IconCheck,
  IconSparkles,
  IconAlertTriangle,
  IconSun,
  IconMoon,
} from './ui/icons';
import {
  loadAttempts,
  loadActiveExam,
  loadFlashcards,
  saveActiveExam,
  saveFlashcards,
} from '@/lib/storage/history';
import { useToast } from './ui/Toast';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  aiStatus: AICapabilityStatus | null;
  name: string;
  onSaveName: (name: string) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  aiStatus,
  name,
  onSaveName,
  theme,
  onToggleTheme,
}: SettingsModalProps) {
  const [draftName, setDraftName] = useState(name);
  const [activeTab, setActiveTab] = useState<'general' | 'ai' | 'data'>('general');
  const { success, error } = useToast();

  if (!isOpen) return null;

  function handleSaveName() {
    onSaveName(draftName.trim());
    success('Display name updated');
  }

  function handleExportData() {
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        version: 2,
        activeExam: loadActiveExam(),
        attempts: loadAttempts(),
        flashcards: loadFlashcards(),
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `zkr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      success('Backup exported successfully');
    } catch {
      error('Failed to export backup data');
    }
  }

  function handleImportData(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (parsed.activeExam) {
          saveActiveExam(parsed.activeExam);
        }
        if (Array.isArray(parsed.flashcards)) {
          saveFlashcards(parsed.flashcards);
        }
        success('Data imported successfully. Please reload the page.');
        setTimeout(() => window.location.reload(), 1200);
      } catch {
        error('Invalid backup file');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <IconSettings size={20} style={{ color: 'var(--accent-text)' }} />
            <h3 style={{ margin: 0, fontSize: '17px' }}>Platform Settings & Engine</h3>
          </div>
          <button className="btn ghost icon-only" onClick={onClose} aria-label="Close dialog">
            <IconX size={16} />
          </button>
        </div>

        {/* Tab selection */}
        <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-subtle)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
          <button
            className={`btn sm ${activeTab === 'general' ? 'primary' : 'ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setActiveTab('general')}
          >
            General & Profile
          </button>
          <button
            className={`btn sm ${activeTab === 'ai' ? 'primary' : 'ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setActiveTab('ai')}
          >
            AI & OCR Engine
          </button>
          <button
            className={`btn sm ${activeTab === 'data' ? 'primary' : 'ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setActiveTab('data')}
          >
            Data & Backup
          </button>
        </div>

        {/* General Tab */}
        {activeTab === 'general' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                Student Display Name
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={draftName}
                  maxLength={35}
                  placeholder="e.g. Alex"
                  onChange={(e) => setDraftName(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn primary" onClick={handleSaveName}>
                  <IconCheck size={14} /> Save
                </button>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--text-tertiary)' }}>
                Personalizes your dashboard greeting and study streaks. Stored securely in your browser.
              </p>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                Interface Appearance
              </label>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className={`btn ${theme === 'dark' ? 'primary' : 'secondary'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={theme === 'light' ? onToggleTheme : undefined}
                >
                  <IconMoon size={16} /> Dark Mode (Obsidian)
                </button>
                <button
                  type="button"
                  className={`btn ${theme === 'light' ? 'primary' : 'secondary'}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={theme === 'dark' ? onToggleTheme : undefined}
                >
                  <IconSun size={16} /> Light Mode (Clean Slate)
                </button>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-text)', marginBottom: '4px' }}>
                <IconShield size={16} />
                <strong style={{ fontSize: '13px' }}>Guaranteed Offline Core</strong>
              </div>
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                PDF text extraction, Tesseract OCR, deterministic parsing, verified scoring, and SM-2 flashcard scheduling operate 100% locally on your machine without transmitting documents to third-party servers unless you explicitly configure an AI provider.
              </p>
            </div>
          </div>
        )}

        {/* AI & Engine Tab */}
        {activeTab === 'ai' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ background: 'var(--bg-subtle)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <IconSparkles size={16} style={{ color: 'var(--accent-text)' }} />
                  <strong style={{ fontSize: '14px' }}>AI Solver & Assistant</strong>
                </div>
                <span className={`badge ${aiStatus?.configured ? 'ok' : 'warn'}`}>
                  {aiStatus?.configured ? 'Configured' : 'Not Configured'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div><strong>Primary Provider:</strong> {aiStatus?.provider ?? 'None'}</div>
                <div><strong>Primary Model:</strong> {aiStatus?.model ?? 'None'}</div>
                <div>
                  <strong>Independent Verifier Model:</strong>{' '}
                  {aiStatus?.verifierConfigured ? (
                    <span style={{ color: 'var(--status-ok-text)' }}>
                      {aiStatus.verifierProvider}/{aiStatus.verifierModel} (Level 3 Active)
                    </span>
                  ) : (
                    <span style={{ color: 'var(--status-warn-text)' }}>
                      Not configured (Falls back to deterministic math / proposals)
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-subtle)', padding: '14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <strong style={{ fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                Optical Character Recognition (OCR) Engine
              </strong>
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                <div>Status: <span style={{ color: 'var(--status-ok-text)' }}>Active (Tesseract 7 + Canvas Native)</span></div>
                <div>Language Data: English (bundled offline)</div>
                <div>Page Cap: 30 pages max per document for resource protection</div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
              <strong style={{ fontSize: '12.5px', color: 'var(--text-primary)' }}>
                Verification Hierarchy:
              </strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <li><strong>Level 1 — Source:</strong> Official answer keys found directly in the exam. Never overwritten.</li>
                <li><strong>Level 2 — AI Reasoning:</strong> Model proposal. Always marked as proposal and excluded from formal scores.</li>
                <li><strong>Level 3 — Independent Verification:</strong> Verified by a distinct model or safe deterministic math.</li>
                <li><strong>Level 4 — Human Confirmation:</strong> Confirmed or corrected by you during review.</li>
              </ul>
            </div>
          </div>
        )}

        {/* Data & Backup Tab */}
        {activeTab === 'data' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <strong style={{ fontSize: '13.5px', display: 'block', marginBottom: '4px' }}>
                Backup & Portability
              </strong>
              <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '0 0 10px 0' }}>
                Download a complete JSON snapshot of your current exam, questions, attempt history, and flashcards.
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn secondary" onClick={handleExportData}>
                  Export JSON Backup
                </button>
                <label className="btn secondary" style={{ cursor: 'pointer' }}>
                  Import Backup
                  <input
                    type="file"
                    accept="application/json"
                    className="sr"
                    onChange={handleImportData}
                  />
                </label>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--status-err-text)', marginBottom: '4px' }}>
                <IconAlertTriangle size={16} />
                <strong style={{ fontSize: '13px' }}>Clear Local Storage</strong>
              </div>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Remove all attempts, active exam questions, and flashcard progress saved in this browser.
              </p>
              <button
                className="btn danger sm"
                onClick={() => {
                  if (confirm('Are you sure you want to clear all your local study data? This cannot be undone.')) {
                    localStorage.clear();
                    success('Local storage cleared');
                    setTimeout(() => window.location.reload(), 1000);
                  }
                }}
              >
                Clear all local study data
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
          <button className="btn secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
