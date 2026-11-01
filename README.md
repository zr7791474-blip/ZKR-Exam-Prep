# ZKR ExamPrep

**Precision Document-to-Exam Learning Platform**

Transform educational documents, worksheets, and exam papers (PDF or image) into interactive, verified learning experiences. ZKR ExamPrep combines deterministic page-aware extraction, offline Tesseract OCR, strict 4-level verification scoring, an interactive SM-2 spaced repetition flashcard engine, and optional dual-model AI explanations.

---

## Key Capabilities & Architecture

- **Deterministic Accuracy First**: Official answer keys extracted from source documents are immutable and cannot be silently overwritten by AI models.
- **Transparent 4-Level Verification**:
  - **Level 1 — Source**: Document answer keys. Scored objectively.
  - **Level 2 — AI Reasoning**: AI suggestions. Excluded from scores until confirmed.
  - **Level 3 — Independent Verification**: Confirmed by an independent verifier model or deterministic arithmetic.
  - **Level 4 — Human Confirmation**: Verified and confirmed by you.
- **Offline Core Architecture**:
  - PDF extraction (`unpdf`), OCR (`tesseract.js` + `@napi-rs/canvas`), parser, SM-2 flashcards, and scoring run 100% locally on your machine without requiring external credentials.
- **Modern Experience & Design System**:
  - Designed with Linear, Stripe, and Vercel-inspired precision.
  - Native Dark and Light themes with persistent state.
  - Global Command Palette (`Ctrl+K` / `⌘K`) for instant navigation and search across past exams.
  - Distraction-free Exam Simulator with hotkeys, live timer, flag-for-review, and palette navigator.
  - Flashcard Study Deck mode with 3D flip card and SM-2 recall grading (`Again`, `Hard`, `Good`, `Easy`).
  - Learning Analytics dashboard with weak-topic diagnostics and 1-click targeted revision drills.

---

## Quick Start

```bash
npm install
npm run dev                  # http://localhost:3000
```

Useful commands:

```bash
npm test          # vitest run (166 tests passing)
npm run lint      # next lint (0 warnings, 0 errors)
npm run build     # production Next.js build
npx tsc --noEmit  # strict TypeScript check (0 errors)
```

Requirements: Node.js 20+ (developed on Node 20/22). No database or external service is required.

---

## Feature Matrix

| Capability | Status | Implementation Notes |
| --- | --- | --- |
| **PDF text extraction** | Complete | Page-aware via `unpdf`; preserves page numbers and multi-column layouts. |
| **Scanned PDF OCR** | Complete | Tesseract.js 7 + `@napi-rs/canvas`; bundled English data, offline. |
| **Image upload OCR** | Complete | PNG/JPG/WebP with client signature validation (max 25MB). |
| **Question parsing** | Complete | Single-choice, multi-answer, true/false, and free-response extraction. |
| **Duplicate/integrity reporting** | Complete | Per-page report, suspicious pages, malformed items, potential duplicates. |
| **Question Library & Review** | Complete | Search, status filters, edit prompts/options, merge, split, dispute resolution. |
| **Exam & Practice Simulator** | Complete | Timed exam, instant practice feedback, random shuffle, question palette, flag toggle (`F`). |
| **Scoring & Learning Reports** | Complete | Objective score strictly on reliable keys; weak topic analytics & revision drills. |
| **Flashcards (SM-2 Spaced Repetition)** | Complete | 3D card flip mode, recall hotkeys (`1`-`4`), interval scheduling, deck statistics. |
| **Global Command Palette** | Complete | `Ctrl+K` / `⌘K` for instant command execution and attempt search. |
| **Client-Side Persistence** | Complete | Defensive, versioned browser `localStorage` with JSON export/import backup. |
| **AI Solving & Verification** | Optional | Requires server API key; Level 3 independent verification supported. |

---

## AI Provider Configuration (Optional)

Copy `.env.example` to `.env.local` to enable optional AI solving and explanations. Keys stay server-side and are never exposed to the client browser.

```dotenv
# OpenAI or any OpenAI-compatible endpoint
AI_PROVIDER=openai
AI_API_KEY=sk-...
AI_MODEL=gpt-4o-mini

# Optional independent verifier model for Level 3 verification
# AI_VERIFIER_PROVIDER=anthropic
# AI_VERIFIER_API_KEY=sk-ant-...
# AI_VERIFIER_MODEL=claude-3-5-haiku-latest
```

When no API key is provided, the platform operates seamlessly in offline mode, and the system engine status badge indicates offline availability.

---

## Answer Statuses & Scoring Integrity

| Status | Scored? | Meaning |
| --- | --- | --- |
| `official_answer` | **Yes** | Explicitly provided by source document. Sacred; never overwritten. |
| `user_confirmed` | **Yes** | Explicitly reviewed and confirmed by the student (Level 4). |
| `ai_verified` | **Yes** | Independently verified by dual models or safe arithmetic (Level 3). |
| `ai_proposed` | **No** | AI model proposal awaiting independent check or student review. |
| `disputed` | **No** | Source key and AI analysis disagree; displayed side-by-side for review. |
| `unanswered` | **No** | No verified answer key exists for this question. |
| `needs_review` | **No** | Ambiguous prompt, incomplete question, or unparsed diagram reference. |

---

## Keyboard Shortcuts

- **Global**:
  - `Ctrl+K` or `⌘K`: Open Command Palette / Global Search.
  - `Esc`: Close any open modal or command palette.
- **Exam & Practice Session**:
  - `1` – `9` or `A` – `D`: Select option choice.
  - `ArrowLeft` / `ArrowRight`: Navigate previous / next question.
  - `F`: Toggle flag for review.
- **Flashcard Study Deck**:
  - `Space` or `Enter`: Flip card to reveal answer and explanation.
  - `1`: Grade recall **Again** (<1 day).
  - `2`: Grade recall **Hard** (1 day).
  - `3`: Grade recall **Good** (SM-2 interval multiplier).
  - `4`: Grade recall **Easy** (Bonus interval).
  - `ArrowLeft` / `ArrowRight`: Previous / next card.

---

## Quality Assurance & Verification

All quality checks pass cleanly:

1. `npx vitest run`: **166 passed, 0 failed across 19 test suites** (2.66s duration).
2. `npx tsc --noEmit`: **0 TypeScript errors** (strict mode enabled).
3. `npm run lint`: **0 ESLint warnings, 0 ESLint errors**.
4. `npm run build`: **Next.js production build succeeded** with all routes prerendered / dynamic.
