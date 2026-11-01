import { explainQuestion } from '../../../../lib/ai/explain';
import { getProvider, publicAIError } from '../../../../lib/ai/provider';
import { toQuestion } from '../../../../lib/ai/request';
import { explainRequestSchema } from '../../../../lib/ai/schemas';
import { aiStatusForError, enforceRateLimit } from '../../../../lib/security/limits';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, 'aiExplain');
  if (!limited.allowed) return limited.response!;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: { code: 'INVALID_BODY', message: 'Send a JSON body.' } },
      { status: 400 },
    );
  }

  const parsed = explainRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'The explain request was invalid.',
          extra: parsed.error.issues.slice(0, 8).map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  const provider = getProvider();
  if (!provider) {
    return Response.json(
      {
        error: {
          code: 'AI_NOT_CONFIGURED',
          message: 'AI is not configured on this server. Explanations require an API key.',
        },
      },
      { status: 503 },
    );
  }

  try {
    const result = await explainQuestion(
      toQuestion(parsed.data.question),
      parsed.data.mode,
      provider,
    );
    return Response.json(result);
  } catch (err) {
    const safe = publicAIError(err);
    return Response.json({ error: safe }, { status: aiStatusForError(safe.code) });
  }
}
