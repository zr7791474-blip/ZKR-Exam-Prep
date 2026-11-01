export interface QuestionOption {
  id: string;
  label: string; // e.g. "A", "B", "C", "D"
  text: string;
  isCorrect?: boolean;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type AnswerStatus =
  | 'official_answer' // explicitly provided by the source document
  | 'ai_proposed' // proposed by AI, not independently checked
  | 'ai_verified' // checked using an independent verification process
  | 'user_confirmed' // reviewed and confirmed by the user
  | 'disputed' // official source answer and AI analysis disagree
  | 'unanswered' // no reliable answer is available
  | 'needs_review'; // ambiguous, incomplete, or missing diagram

export type VerificationLevel = 1 | 2 | 3 | 4;
// Level 1: Source verification
// Level 2: AI reasoning
// Level 3: Independent verification
// Level 4: Human confirmation

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'free_response';

export type AnswerValue = string | string[] | null;

export type ProcessingStage =
  | 'validating'
  | 'extracting_text'
  | 'ocr'
  | 'detecting_questions'
  | 'recovering_answers'
  | 'solving'
  | 'verifying'
  | 'preparing'
  | 'done';

export interface ProcessingStageEvent {
  stage: ProcessingStage;
  label: string;
  detail?: string;
  page?: number;
  totalPages?: number;
  completed: boolean;
}

export interface OptionAnalysis {
  option: string;
  isCorrect: boolean;
  reason: string;
}

export interface AIQuestionSolution {
  answer: string;
  answerText: string;
  explanation: string;
  optionAnalysis: OptionAnalysis[];
  confidence: ConfidenceLevel;
  status: AnswerStatus;
  verificationLevel: VerificationLevel;
  questionType?: QuestionType;
  verificationMethod?: string;
  assumptions?: string[];
  missingInformation?: string[];
  disputeReason?: string;
  sources?: string[];
  subjectTopic?: string;
  provider?: string;
  model?: string;
  generatedAt?: string;
}

export interface Question {
  id: string;
  index: number; // 1-based original question number
  prompt: string;
  options: QuestionOption[];
  correctOptionId: string | null; // primary correct option (single answer)
  correctOptionIds?: string[]; // all correct options (multiple-answer questions)
  hasKnownAnswer: boolean; // explicitly distinguishes known vs unknown
  confidence: ConfidenceLevel;
  explanation?: string;
  questionType?: QuestionType;
  acceptedAnswers?: string[]; // free-response accepted answers (normalised comparison)
  // Origin and Verification Metadata
  pageNumber?: number;
  sourceReference?: string;
  answerStatus: AnswerStatus;
  verificationLevel: VerificationLevel;
  officialAnswerLabel?: string;
  officialAnswerLabels?: string[];
  officialCorrectOptionId?: string | null;
  officialCorrectOptionIds?: string[];
  aiSolution?: AIQuestionSolution;
  disputeExplanation?: string;
  subjectTopic?: string;
  hasDiagram?: boolean;
  imageRefs?: { pageNumber: number; label?: string }[];
  isAiGenerated?: boolean;
  generation?: 'source' | 'ai';
  fingerprint?: string;
  ocrConfidence?: number;
  missingInformation?: string[];
  userConfirmedAt?: string;
}

export interface ProcessingPage {
  pageNumber: number;
  textLength: number;
  questionCount: number;
  method: 'text' | 'ocr' | 'none';
  ocrConfidence?: number;
  warning?: string;
}

export interface DocumentProcessingReport {
  totalPages: number;
  pagesProcessed: number;
  extractedCount: number;
  officialAnswerCount: number;
  aiSolvedCount: number;
  aiProposedCount?: number;
  aiVerifiedCount?: number;
  disputedCount: number;
  needsReviewCount: number;
  unkeyedCount: number;
  suspiciousPages: { page: number; textSnippet: string; reason: string }[];
  potentialDuplicates: { q1Index: number; q2Index: number; prompt: string }[];
  malformedQuestions: { index: number; reason: string }[];
  ocrUsed: boolean;
  ocrPages?: number[];
  emptyPages?: number[];
  failedPages?: { page: number; reason: string }[];
  warnings?: string[];
  documentKind?: 'text_pdf' | 'scanned_pdf' | 'mixed_pdf' | 'image' | 'unknown';
  pages?: ProcessingPage[];
  aiConfigured?: boolean;
  durationMs?: number;
}

export interface Exam {
  id: string;
  title: string;
  sourceFileName: string;
  uploadedAt: string;
  questions: Question[];
  totalPages?: number;
  rawTextPreview?: string;
  processingReport?: DocumentProcessingReport;
  documentKind?: DocumentProcessingReport['documentKind'];
}

export type ExamMode = 'exam' | 'practice' | 'shuffle';

export interface WeakTopic {
  topic: string;
  incorrectCount: number;
  totalCount: number;
  accuracy: number;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  examTitle: string;
  startedAt: string;
  completedAt: string;
  mode: ExamMode;
  answers: Record<string, AnswerValue>; // questionId -> selectedOptionId(s)
  freeTextAnswers?: Record<string, string>;
  totalQuestions: number;
  knownAnswerQuestions: number;
  unknownAnswerQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  scorePercentage: number | null; // reliable score, e.g. 85 for 85%, or null
  reliableKnownAnswerQuestions?: number;
  aiProposedCount?: number;
  disputedCount?: number;
  questionsSnapshot: Question[]; // snapshots the questions (and option orders) as presented
  weakTopics?: WeakTopic[];
  revisionQuestionIds?: string[];
}

export interface ScoreSummary {
  totalQuestions: number;
  knownAnswerQuestions: number;
  unknownAnswerQuestions: number;
  answeredCount: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  scorePercentage: number | null;
  reliableKnownAnswerQuestions?: number;
  aiProposedQuestions?: number;
  disputedQuestions?: number;
  needsReviewQuestions?: number;
  freeResponseQuestions?: number;
  mistakes: {
    question: Question;
    selectedOptionId: string | null;
    selectedOptionIds?: string[];
    correctOptionId: string | null;
    correctOptionIds?: string[];
    isUnanswered: boolean;
  }[];
}

export interface FlashcardItem {
  id: string;
  questionId: string;
  prompt: string;
  options: QuestionOption[];
  correctOptionId: string | null;
  correctOptionIds?: string[];
  explanation?: string;
  subjectTopic?: string;
  answerStatus?: AnswerStatus;
  verificationLevel?: VerificationLevel;
  interval: number; // days
  repetition: number;
  easeFactor: number;
  dueDate: string; // ISO date
  lastReviewed?: string;
  createdAt?: string;
}

export type PdfExtractionErrorCode =
  | 'EMPTY'
  | 'EMPTY_OR_SCANNED'
  | 'ENCRYPTED'
  | 'MALFORMED'
  | 'UNSUPPORTED';

export type PdfExtractionResult =
  | {
      ok: true;
      text: string;
      pages: string[];
      totalPages: number;
      /** Pages that had no usable text layer and may need OCR. */
      emptyPages?: number[];
      /** True when at least one page had no text layer. */
      needsOcr?: boolean;
    }
  | {
      ok: false;
      code: PdfExtractionErrorCode;
      message: string;
      totalPages?: number;
    };

export interface AICapabilityStatus {
  configured: boolean;
  provider: string;
  model: string;
  verifierConfigured: boolean;
  verifierProvider?: string | null;
  verifierModel?: string | null;
  capabilities: {
    solve: boolean;
    explain: boolean;
    challenge: boolean;
    similar: boolean;
    independentVerification: boolean;
    ocr: boolean;
    pdfRasterisation: boolean;
  };
  message: string;
}

export interface ExtractionResult {
  ok: boolean;
  code?: string;
  message?: string;
  totalPages?: number;
  documentKind?: DocumentProcessingReport['documentKind'];
  questions: Question[];
  report?: DocumentProcessingReport;
  textPreview?: string;
  pages?: ProcessingPage[];
  ocrUsed?: boolean;
  warnings?: string[];
}
