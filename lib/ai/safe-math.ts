import type { Question } from '../models/exam';

export interface MathVerification {
  checked: boolean;
  verified: boolean;
  method: string;
  detail: string;
  computed?: number;
  expectedLabel?: string;
}

/**
 * Safe arithmetic evaluator. Deliberately supports only numbers, operators,
 * parentheses, constants and a small function whitelist. No eval/Function.
 */
export function evaluateMathExpression(input: string): number | null {
  const expression = input
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!expression || expression.length > 300) return null;

  let index = 0;

  function peek(): string {
    return expression[index] ?? '';
  }

  function consume(char: string): boolean {
    if (peek() === char) {
      index++;
      return true;
    }
    return false;
  }

  function parseNumber(): number | null {
    const match = expression.slice(index).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  }

  function parseIdentifier(): string | null {
    const match = expression.slice(index).match(/^[a-zA-Z]+/);
    if (!match) return null;
    index += match[0].length;
    return match[0].toLowerCase();
  }

  function parsePrimary(): number | null {
    if (consume('(')) {
      const value = parseExpression();
      if (value === null || !consume(')')) return null;
      return value;
    }

    if (peek() === '+' || peek() === '-') {
      const sign = consume('-') ? -1 : (consume('+'), 1);
      const value = parsePrimary();
      return value === null ? null : sign * value;
    }

    const number = parseNumber();
    if (number !== null) return number;

    const identifier = parseIdentifier();
    if (!identifier) return null;
    if (identifier === 'pi') return Math.PI;
    if (identifier === 'e') return Math.E;

    if (consume('(')) {
      const argument = parseExpression();
      if (argument === null || !consume(')')) return null;
      switch (identifier) {
        case 'sqrt':
          return argument < 0 ? null : Math.sqrt(argument);
        case 'abs':
          return Math.abs(argument);
        case 'sin':
          return Math.sin(argument);
        case 'cos':
          return Math.cos(argument);
        case 'tan':
          return Math.tan(argument);
        case 'ln':
          return argument <= 0 ? null : Math.log(argument);
        case 'log':
          return argument <= 0 ? null : Math.log10(argument);
        case 'round':
          return Math.round(argument);
        case 'floor':
          return Math.floor(argument);
        case 'ceil':
          return Math.ceil(argument);
        default:
          return null;
      }
    }

    return null;
  }

  function parsePower(): number | null {
    const base = parsePrimary();
    if (base === null) return null;
    if (consume('^')) {
      const exponent = parsePower();
      if (exponent === null) return null;
      return base ** exponent;
    }
    return base;
  }

  function parseTerm(): number | null {
    let value = parsePower();
    if (value === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = peek();
      index++;
      const right = parsePower();
      if (right === null) return null;
      if (op === '/' && right === 0) return null;
      value = op === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseExpression(): number | null {
    let value = parseTerm();
    if (value === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = peek();
      index++;
      const right = parseTerm();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  const result = parseExpression();
  if (result === null || index !== expression.length || !Number.isFinite(result)) return null;
  return result;
}

/** Extracts a computable expression from a word problem, when one is explicit. */
export function extractNumericExpression(text: string): string | null {
  const normalized = text
    .replace(/[×✕]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\bplus\b/gi, '+')
    .replace(/\bminus\b/gi, '-')
    .replace(/\btimes\b/gi, '*')
    .replace(/\bdivided\s+by\b/gi, '/');

  const percentOf = normalized.match(/(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)/i);
  if (percentOf) return `(${percentOf[1]}/100)*${percentOf[2]}`;

  const patterns = [
    /what\s+is\s+(.+?)\s*\?/i,
    /calculate\s+(.+?)(?:[.?]|$)/i,
    /compute\s+(.+?)(?:[.?]|$)/i,
    /evaluate\s+(.+?)(?:[.?]|$)/i,
    /solve\s+(.+?)(?:[.?]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const candidate = match[1].replace(/[^0-9+\-*/^().%a-zA-Z\s]/g, ' ').trim();
      if (/\d/.test(candidate) && /[+\-*/^]/.test(candidate)) {
        const value = evaluateMathExpression(candidate);
        if (value !== null) return candidate;
      }
    }
  }

  const bare = normalized.match(/(?:^|\s)(\d+(?:\.\d+)?\s*[+\-*/^]\s*\d+(?:\.\d+)?(?:\s*[+\-*/^]\s*\d+(?:\.\d+)?)*)/);
  if (bare && evaluateMathExpression(bare[1]) !== null) return bare[1];
  return null;
}

/** Extracts a numeric value from an option such as `3/4`, `0.75`, `75%`, `12 m/s`. */
export function numericValueOfOption(text: string): number | null {
  const trimmed = text.trim();
  const percent = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (percent) return Number(percent[1]) / 100;

  const fraction = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }

  const number = trimmed.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
  if (!number) return null;
  const value = Number(number[0]);
  return Number.isFinite(value) ? value : null;
}

function closeEnough(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-6;
}

/**
 * Deterministic Level-3 verification for arithmetic questions.
 * Returns `checked: false` when the question is not safely computable.
 */
export function verifyMathQuestion(
  question: Question,
  proposedLabels: string[],
): MathVerification {
  if (question.options.length === 0) {
    return {
      checked: false,
      verified: false,
      method: 'deterministic arithmetic',
      detail: 'No options to compare a computed result against.',
    };
  }

  const expression = extractNumericExpression(question.prompt);
  if (!expression) {
    return {
      checked: false,
      verified: false,
      method: 'deterministic arithmetic',
      detail: 'No safely computable expression was found in the question.',
    };
  }

  const computed = evaluateMathExpression(expression);
  if (computed === null) {
    return {
      checked: false,
      verified: false,
      method: 'deterministic arithmetic',
      detail: 'The expression could not be evaluated safely.',
    };
  }

  const matching = question.options.find((option) => {
    const value = numericValueOfOption(option.text);
    return value !== null && closeEnough(value, computed);
  });

  if (!matching) {
    return {
      checked: true,
      verified: false,
      method: 'deterministic arithmetic',
      detail: `Computed ${computed}, but no option matches that value.`,
      computed,
    };
  }

  const verified = proposedLabels.some(
    (label) => label.toUpperCase() === matching.label.toUpperCase(),
  );
  return {
    checked: true,
    verified,
    method: 'deterministic arithmetic',
    detail: verified
      ? `Independent calculation confirms ${matching.label} (${computed}).`
      : `Independent calculation gives ${computed} (option ${matching.label}), which disagrees with the proposed answer.`,
    computed,
    expectedLabel: matching.label,
  };
}
