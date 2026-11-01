import { describeAIConfig } from '../../../../lib/ai/provider';
import {
  isOcrAvailable,
  isPdfRasterisationAvailable,
} from '../../../../lib/extraction/ocr';
import { enforceRateLimit } from '../../../../lib/security/limits';

export const runtime = 'nodejs';

/**
 * Reports which capabilities are genuinely available on this server.
 * Secrets are never returned; only whether a provider is configured.
 */
export async function GET(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, 'aiStatus');
  if (!limited.allowed) return limited.response!;

  const config = describeAIConfig();
  const ocr = isOcrAvailable();
  const rasterisation = isPdfRasterisationAvailable();

  return Response.json({
    configured: config.configured,
    provider: config.provider,
    model: config.model,
    verifierConfigured: config.verifierConfigured,
    verifierProvider: config.verifierProvider ?? null,
    verifierModel: config.verifierModel ?? null,
    capabilities: {
      solve: config.configured,
      explain: config.configured,
      challenge: config.configured,
      similar: config.configured,
      independentVerification: config.verifierConfigured,
      ocr,
      pdfRasterisation: rasterisation,
    },
    message: config.configured
      ? 'AI is configured. Answers are still validated, and official source answers are never overwritten.'
      : 'AI is not configured. Extraction, review, practice, scoring, and flashcards work without an API key.',
  });
}
