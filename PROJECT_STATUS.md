# Project Status — ZKR ExamPrep

## 1. Product Vision & Positioning

ZKR ExamPrep transforms educational documents, worksheets, and exam papers (PDF or image) into interactive, verified learning experiences. The core workflow is deterministic, completely credential-free, and runs offline on the local server. AI solving and dual-model verification are optional server-side additions, with strict verification levels and answer statuses ensuring that AI proposals are never mistaken for official keys.

---

## 2. Technology Stack

- **Next.js 15.5.6 (App Router)**, React 19, TypeScript 5 (strict mode enabled), Tailwind CSS 4
- **Extraction & OCR**: `unpdf` 2.1.0 (page-aware text extraction) + `tesseract.js` 7 + `@tesseract.js-data/eng` + `@napi-rs/canvas` (offline English OCR and PDF page rasterisation)
- **Validation**: `zod` 3 for strict schema validation of API requests and structured model outputs
- **Test Engine**: Vitest 2.1.9 for comprehensive unit and integration suites
- **Persistence**: Browser `localStorage` (defensive versioned schema for attempts, active exam, and flashcards) + JSON backup export/import
- **Optional AI Providers**: OpenAI-compatible endpoints, Anthropic, or local mock provider

---

## 3. Architecture & Components

### Extraction Engine
- `lib/extraction/pdf.ts`: Page-by-page PDF text extraction, scanned/empty detection, password detection, and canvas rasterisation.
- `lib/extraction/ocr.ts`: Tesseract worker lifecycle, bundled English traineddata, timeout bounding, and error recovery.
- `lib/extraction/pipeline.ts`: Full pipeline — text extraction, OCR fallback, question parsing, answer-key recovery, AI solving hooks, and diagnostic report.
- `lib/extraction/text.ts`: Unicode normalisation, ligature and soft-hyphen repair, two-column reconstruction, and OCR spacing heuristics.
- `lib/extraction/mcq.ts`: Deterministic parser for numbered questions, options, multi-answer keys, free response, answer-key sections, duplicate detection, and malformed questions.

### AI Engine & Verification Hierarchy
- `lib/ai/provider.ts`: Provider abstraction, environment detection, OpenAI/Anthropic adapters, retries, and safe error masking.
- `lib/ai/schemas.ts`: Strict Zod output and request schemas.
- `lib/ai/prompts.ts`: Subject-aware solve/verify/explain/challenge/similar prompts.
- `lib/ai/verify-answer.ts`: Dual-model independent verification orchestration.
- `lib/ai/safe-math.ts`: Deterministic AST-free arithmetic evaluator for Level 3 mathematical verification.
- `lib/ai/solve-question.ts`: Solving logic, dispute detection, official-key preservation, and verification levels.
- `lib/ai/explain.ts`: Explanations (simpler, step-by-step, example), answer challenges, and similar-question synthesis.

### UI & Product Components
- `components/Home.tsx`: Application shell orchestrator, top navigation tabs, active exam banner, dashboard statistics, theme toggle, and keyboard shortcuts.
- `components/UploadZone.tsx`: High-fidelity drag-and-drop zone with animated hover, file format chips (PDF, JPG, PNG, WebP), live stage-by-stage processing feedback, and inline PDF/image preview.
- `components/QuestionReview.tsx`: Question library with live text filter, status badges, verification level indicators, inline prompt/option editors, add/merge/split/remove, and dispute resolution banner.
- `components/PracticeSession.tsx`: Timed exam and practice simulator with live timer, question palette, flag toggle (`F`), instant practice check, AI explanations, and hotkey option selection (`1`-`9`).
- `components/ExamResultView.tsx`: Verified score hero distinguishing scored keys from proposals, diagnostic weak-topic bars, mistake review, and 1-click targeted revision drill launcher.
- `components/FlashcardsView.tsx`: Spaced repetition flashcards with SM-2 interval scheduling, interactive 3D card study mode, recall grading hotkeys (`1`-`4`), and deck statistics.
- `components/AnalyticsView.tsx`: Comprehensive learning analytics, mastery distribution, weak topics ranking, and session history progression.
- `components/SettingsModal.tsx`: Platform settings, live AI & OCR engine status, dark/light appearance toggle, and complete JSON backup export/import.
- `components/CommandPalette.tsx`: Global search & command palette (`Ctrl+K` / `⌘K`) for instant attempt search and view navigation.
- `components/ui/Toast.tsx`: Non-blocking, accessible toast notification system.
- `components/ui/icons.tsx`: Zero-dependency, lightweight, crisp SVG icon library.
- `components/ProcessingReport.tsx`: Detailed diagnostics: per-page extraction log, failed pages, suspicious pages, and potential duplicates.

---

## 4. Verification Results

Commands executed on 2026-11-01:

1. `npx vitest run`: **166 passed, 0 failed across 19 test files** (duration 2.66s).
   - `lib/exam/scoring-status.test.ts` (9 tests)
   - `lib/exam/flashcards.test.ts` (7 tests)
   - `lib/exam/analytics.test.ts` (7 tests)
   - `lib/ai/provider.test.ts` (16 tests)
   - `lib/ai/safe-math.test.ts` (12 tests)
   - `lib/ai/schemas.test.ts` (11 tests)
   - `lib/extraction/mcq.test.ts` (7 tests)
   - `lib/ai/solve-question.test.ts` (8 tests)
   - `lib/extraction/pipeline.test.ts` (5 tests)
   - `lib/ai/routes.test.ts` (15 tests)
   - `lib/exam/scoring.test.ts` (6 tests)
   - `lib/exam/shuffle.test.ts` (4 tests)
   - `lib/security/rate-limit.test.ts` (9 tests)
   - `lib/extraction/text.test.ts` (13 tests)
   - `lib/storage/history.test.ts` (6 tests)
   - `lib/ai/request.test.ts` (4 tests)
   - `lib/validation/file.test.ts` (14 tests)
   - `lib/extraction/pdf.test.ts` (5 tests)
   - `app/api/documents/route.test.ts` (8 tests)

2. `npx tsc --noEmit`: **0 errors** (strict TypeScript compliance across all components).

3. `npm run lint`: **0 warnings, 0 errors** (`next lint` passed cleanly).

4. `npm run build`: **Production build succeeded**; static pages generated (10/10), all 6 dynamic API routes verified.

---

## 5. Answer Statuses & Verification Levels

| Status | Verification Level | Included in Score? | Meaning |
| --- | --- | --- | --- |
| `official_answer` | 1 | Yes | Explicitly provided by source document. Sacred; never overwritten. |
| `user_confirmed` | 4 | Yes | Explicitly reviewed and confirmed by the student. |
| `ai_verified` | 3 | Yes | Independently verified by dual models or deterministic arithmetic. |
| `ai_proposed` | 2 | No | Model suggestion awaiting independent verification or student review. |
| `disputed` | 1 or 2 | No | Source key and AI analysis disagree; displayed side-by-side for review. |
| `needs_review` | 1 | No | Ambiguous question, incomplete prompt, or unparsed diagram reference. |
| `unanswered` | 1 | No | No verified answer key exists for this question. |

---

## 6. Known Limitations

- AI provider integration is tested with mock providers in unit tests; live calls require configuring valid credentials in `.env.local`.
- Persistence uses browser `localStorage`; multi-device sync or server-side accounts are not implemented yet.
- Bundled OCR data is English-only; other languages require adding their traineddata file in `lib/extraction/ocr.ts`.
- OCR is capped at 30 pages per upload for bounded execution cost; documents are capped at 200 pages.
- Diagram-heavy questions are flagged for manual review rather than guessed.
