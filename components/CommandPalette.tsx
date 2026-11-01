'use client';

import React, { useEffect, useState, useRef } from 'react';
import type { ExamAttempt } from '@/lib/models/exam';
import {
  IconSearch,
  IconDocument,
  IconLayers,
  IconBookOpen,
  IconShuffle,
  IconBarChart,
  IconSettings,
  IconClock,
  IconX,
} from './ui/icons';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  attempts: ExamAttempt[];
  onSelectAttempt: (attempt: ExamAttempt) => void;
  onNavigate: (view: 'dashboard' | 'upload' | 'review' | 'practice' | 'flashcards' | 'analytics') => void;
  onOpenSettings: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  attempts,
  onSelectAttempt,
  onNavigate,
  onOpenSettings,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.trim().toLowerCase();

  interface PaletteItem {
    id: string;
    label: string;
    subtitle?: string;
    icon: React.ReactNode;
    action: () => void;
  }

  // Navigation targets
  const navItems: PaletteItem[] = [
    { id: 'nav-dash', label: 'Go to Dashboard', icon: <IconLayers size={16} />, action: () => { onNavigate('dashboard'); onClose(); } },
    { id: 'nav-upload', label: 'Upload New Exam / Document', icon: <IconDocument size={16} />, action: () => { onNavigate('upload'); onClose(); } },
    { id: 'nav-review', label: 'Question Library & Review', icon: <IconBookOpen size={16} />, action: () => { onNavigate('review'); onClose(); } },
    { id: 'nav-practice', label: 'Start Practice Session', icon: <IconBookOpen size={16} />, action: () => { onNavigate('practice'); onClose(); } },
    { id: 'nav-flashcards', label: 'Open Spaced Repetition Flashcards', icon: <IconShuffle size={16} />, action: () => { onNavigate('flashcards'); onClose(); } },
    { id: 'nav-analytics', label: 'View Learning Analytics', icon: <IconBarChart size={16} />, action: () => { onNavigate('analytics'); onClose(); } },
    { id: 'nav-settings', label: 'Open Settings & Engine Config', icon: <IconSettings size={16} />, action: () => { onOpenSettings(); onClose(); } },
  ].filter((item) => !q || item.label.toLowerCase().includes(q));

  // Matched attempts
  const matchedAttempts: PaletteItem[] = attempts
    .filter((a) => !q || a.examTitle.toLowerCase().includes(q))
    .slice(0, 6)
    .map((a) => ({
      id: `attempt-${a.id}`,
      label: a.examTitle,
      subtitle: `${a.scorePercentage !== null ? `Score: ${a.scorePercentage}%` : `${a.answeredCount} answered`} • ${new Date(a.completedAt).toLocaleDateString()}`,
      icon: <IconClock size={16} />,
      action: () => { onSelectAttempt(a); onClose(); },
    }));

  const allItems: PaletteItem[] = [...navItems, ...matchedAttempts];

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className="modal-box"
        style={{ width: 'min(600px, 100%)', padding: 0, overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <IconSearch size={18} style={{ color: 'var(--text-tertiary)' }} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Search commands, exams, history..."
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              boxShadow: 'none',
              padding: 0,
              fontSize: '15px',
              color: 'var(--text-primary)',
            }}
          />
          <button className="btn ghost sm icon-only" onClick={onClose}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ maxHeight: '380px', overflowY: 'auto', padding: '8px' }}>
          {allItems.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '14px' }}>
              No matches found for &quot;{query}&quot;
            </div>
          ) : (
            allItems.map((item, idx) => (
              <div
                key={item.id}
                onClick={item.action}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  cursor: 'pointer',
                  background: selectedIndex === idx ? 'var(--bg-surface-hover)' : 'transparent',
                  color: selectedIndex === idx ? 'var(--text-primary)' : 'var(--text-secondary)',
                  transition: 'all 0.1s ease',
                }}
              >
                <div style={{ color: selectedIndex === idx ? 'var(--accent-text)' : 'var(--text-tertiary)' }}>
                  {item.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: selectedIndex === idx ? 600 : 500 }}>
                    {item.label}
                  </div>
                  {'subtitle' in item && item.subtitle && (
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      {item.subtitle}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>↵</span>
              </div>
            ))
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            background: 'var(--bg-subtle)',
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
          }}
        >
          <span>Use <kbd>↑</kbd> <kbd>↓</kbd> to navigate, <kbd>↵</kbd> to select</span>
          <span><kbd>ESC</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
