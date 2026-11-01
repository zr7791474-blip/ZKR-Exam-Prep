import {
  getProvider,
  getVerifierProvider,
  publicAIError,
} from '../../../../lib/ai/provider';
import { toQuestion } from '../../../../lib/ai/request';
import { solveRequestSchema } from '../../../../lib/ai/schemas';
import { solveQuestions } from '../../../../lib/ai/solve-question';
import { aiStatusForError, enforceRateLimit } from '../../../../lib/security/limits';

export const runtime = 'nodejs';

function jsonError(status: number, code: string, message: string, extra?: unknown) {
  return Response.json({ error: { code, message, ...(extra ? { extra } : {}) } }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, 'aiSolve');
  if (!limited.allowed) return limited.response!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'INVALID_BODY', 'Send a JSON body.');
  }

  const parsed = solveRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      400,
      'INVALID_REQUEST',
      'The solve request was invalid.',
      parsed.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }

  const provider = getProvider();
  if (!provider) {
    return jsonError(
      503,
      'AI_NOT_CONFIGURED',
      'AI is not configured on this server. Add AI_PROVIDER and an API key to enable solving.',
    );
  }

  const verifier = getVerifierProvider();

  try {
    const result = await solveQuestions(parsed.data.questions.map(toQuestion), {
      provider,
      verifier,
      checkOfficialAnswers: parsed.data.checkOfficialAnswers,
      maxQuestions: parsed.data.maxQuestions,
      concurrency: 3,
    });

    return Response.json({
      ...result,
      provider: provider.name,
      model: provider.model,
      verifierConfigured: Boolean(verifier),
      verificationNote: verifier
        ? 'A separate verifier model is configured; verified answers use independent verification.'
        : 'No separate verifier model is configured. AI answers remain proposals and are excluded from objective scores.',
    });
  } catch (err) {
    const safe = publicAIError(err);
    return Response.json({ error: safe }, { status: aiStatusForError(safe.code) });
  }
}
