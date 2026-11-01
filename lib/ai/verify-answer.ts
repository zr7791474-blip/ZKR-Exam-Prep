import type { Question } from '../models/exam';
import { parseJsonObject, type ProviderClient } from './provider';
import { buildVerificationPrompt } from './prompts';
import { validateSolutionForQuestion, type RawAISolution } from './schemas';
import { verifyMathQuestion } from './safe-math';

export interface VerificationResult {
  level: 1 | 2 | 3;
  verified: boolean;
  disagrees: boolean;
  method: string;
  detail: string;
  independentLabels: string[];
  independentSolution?: RawAISolution;
}

export function solutionLabels(
  solution: RawAISolution,
  question: Pick<Question, 'options'>,
): string[] {
  const values = solution.answers?.length ? solution.answers : [solution.answer];
  const labels: string[] = [];

  for (const value of values) {
    const upper = value.trim().toUpperCase();
    if (/^[A-J]$/.test(upper)) {
      labels.push(upper);
      continue;
    }
    if (/^\d{1,2}$/.test(upper)) {
      const option = question.options[parseInt(upper, 10) - 1];
      if (option) labels.push(option.label.toUpperCase());
      continue;
    }
    const byText = question.options.find(
      (option) =>
        option.text.trim().toLowerCase() === value.trim().toLowerCase() ||
        option.text.trim().toLowerCase().includes(value.trim().toLowerCase()),
    );
    if (byText) labels.push(byText.label.toUpperCase());
  }

  return [...new Set(labels)];
}

function sameAnswerSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].map((v) => v.toUpperCase()).sort();
  const right = [...b].map((v) => v.toUpperCase()).sort();
  return left.every((value, idx) => value === right[idx]);
}

/**
 * Level 3 verification. Uses a genuinely different verifier model when
 * configured, and deterministic arithmetic when the question is computable.
 * A same-model second pass is reported as self-consistency, never as independent
 * verification.
 */
export async function verifyAnswer(
  question: Question,
  proposedLabels: string[],
  options: { verifier?: ProviderClient | null; primary?: ProviderClient | null; signal?: AbortSignal } = {},
): Promise<VerificationResult> {
  const math = verifyMathQuestion(question, proposedLabels);
  if (math.checked) {
    return {
      level: 3,
      verified: math.verified,
      disagrees: !math.verified,
      method: math.method,
      detail: math.detail,
      independentLabels: math.expectedLabel ? [math.expectedLabel] : [],
    };
  }

  const verifier = options.verifier ?? null;
  if (!verifier) {
    return {
      level: 2,
      verified: false,
      disagrees: false,
      method: 'AI reasoning only',
      detail:
        'No independent verifier model or deterministic check is configured, so the answer remains an AI proposal.',
      independentLabels: [],
    };
  }

  const { system, user } = buildVerificationPrompt(question, proposedLabels);
  try {
    const raw = await verifier.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { json: true, signal: options.signal },
    );
    const validation = validateSolutionForQuestion(parseJsonObject(raw), question);
    if (!validation.ok || !validation.solution) {
      return {
        level: 2,
        verified: false,
        disagrees: false,
        method: 'independent verification failed',
        detail: `Verifier output was rejected: ${validation.errors.slice(0, 2).join('; ')}`,
        independentLabels: [],
      };
    }

    const independentLabels = solutionLabels(validation.solution, question);
    const agrees = sameAnswerSet(independentLabels, proposedLabels);
    const isDifferentModel =
      !options.primary ||
      verifier.name !== options.primary.name ||
      verifier.model !== options.primary.model;

    return {
      level: isDifferentModel ? 3 : 2,
      verified: agrees,
      disagrees: independentLabels.length > 0 && !agrees,
      method: isDifferentModel
        ? `independent ${verifier.name}/${verifier.model} verification`
        : `self-consistency pass (${verifier.model})`,
      detail: agrees
        ? `A second pass${isDifferentModel ? ' with a different model' : ' with the same model'} reached the same answer (${independentLabels.join(', ')}).`
        : `The second pass chose ${independentLabels.join(', ') || 'no valid answer'}, which disagrees with ${proposedLabels.join(', ') || 'the first pass'}.`,
      independentLabels,
      independentSolution: validation.solution,
    };
  } catch (err) {
    return {
      level: 2,
      verified: false,
      disagrees: false,
      method: 'independent verification failed',
      detail: err instanceof Error ? err.message : 'The verifier could not complete.',
      independentLabels: [],
    };
  }
}
