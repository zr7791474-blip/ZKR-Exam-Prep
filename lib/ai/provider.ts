export type AIProviderName = 'openai' | 'anthropic' | 'mock';

export type AIErrorCode =
  | 'MISSING_KEY'
  | 'INVALID_KEY'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_RESPONSE'
  | 'BAD_REQUEST';

export class AIProviderError extends Error {
  code: AIErrorCode;
  retryable: boolean;
  status?: number;

  constructor(code: AIErrorCode, message: string, options: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderClient {
  name: string;
  model: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export interface ProviderSettings {
  provider: AIProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens: number;
  timeoutMs: number;
  maxRetries: number;
}

export interface AIConfig {
  configured: boolean;
  provider: AIProviderName | 'none';
  model: string;
  baseUrl?: string;
  verifierConfigured: boolean;
  verifierProvider?: AIProviderName;
  verifierModel?: string;
}

export interface CreateProviderDeps {
  fetchImpl?: typeof fetch;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normaliseProvider(value: string | undefined): AIProviderName | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower === 'openai' || lower === 'openai-compatible' || lower === 'compatible') return 'openai';
  if (lower === 'anthropic' || lower === 'claude') return 'anthropic';
  if (lower === 'mock') return 'mock';
  return null;
}

export function readProviderSettings(env: NodeJS.ProcessEnv = process.env): ProviderSettings | null {
  const explicit = normaliseProvider(env.AI_PROVIDER);
  if (explicit === 'mock') {
    return {
      provider: 'mock',
      apiKey: 'mock',
      model: env.AI_MODEL?.trim() || 'mock-model',
      maxTokens: Number(env.AI_MAX_TOKENS) || 1800,
      timeoutMs: Number(env.AI_TIMEOUT_MS) || 60_000,
      maxRetries: Number(env.AI_MAX_RETRIES) || 1,
    };
  }

  const openaiKey = envValue(env, 'AI_API_KEY', 'OPENAI_API_KEY');
  const anthropicKey = envValue(env, 'ANTHROPIC_API_KEY');
  const provider =
    explicit ??
    (openaiKey ? 'openai' : anthropicKey ? 'anthropic' : null);

  if (!provider) return null;
  if (provider === 'anthropic' && !anthropicKey) return null;
  if (provider === 'openai' && !openaiKey) return null;

  const model =
    envValue(env, 'AI_MODEL', 'OPENAI_MODEL') ??
    (provider === 'anthropic' ? 'claude-3-5-haiku-latest' : 'gpt-4o-mini');

  return {
    provider,
    apiKey: provider === 'anthropic' ? anthropicKey! : openaiKey!,
    model,
    baseUrl:
      provider === 'anthropic'
        ? envValue(env, 'AI_BASE_URL') ?? 'https://api.anthropic.com/v1'
        : envValue(env, 'AI_BASE_URL', 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
    maxTokens: Number(env.AI_MAX_TOKENS) || 1800,
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 60_000,
    maxRetries: Number(env.AI_MAX_RETRIES) || 2,
  };
}

export function readVerifierSettings(env: NodeJS.ProcessEnv = process.env): ProviderSettings | null {
  const verifierModel = envValue(env, 'AI_VERIFIER_MODEL');
  if (!verifierModel) return null;

  const base = readProviderSettings(env);
  const explicit = normaliseProvider(env.AI_VERIFIER_PROVIDER) ?? base?.provider ?? 'openai';
  if (explicit === 'mock') {
    return {
      provider: 'mock',
      apiKey: 'mock',
      model: verifierModel,
      maxTokens: Number(env.AI_MAX_TOKENS) || 1800,
      timeoutMs: Number(env.AI_TIMEOUT_MS) || 60_000,
      maxRetries: 1,
    };
  }

  const key =
    envValue(env, 'AI_VERIFIER_API_KEY') ??
    (explicit === 'anthropic' ? envValue(env, 'ANTHROPIC_API_KEY') : envValue(env, 'AI_API_KEY', 'OPENAI_API_KEY'));
  if (!key) return null;

  return {
    provider: explicit,
    apiKey: key,
    model: verifierModel,
    baseUrl:
      envValue(env, 'AI_VERIFIER_BASE_URL') ??
      (explicit === 'anthropic' ? 'https://api.anthropic.com/v1' : envValue(env, 'AI_BASE_URL', 'OPENAI_BASE_URL') ?? 'https://api.openai.com/v1'),
    maxTokens: Number(env.AI_MAX_TOKENS) || 1800,
    timeoutMs: Number(env.AI_TIMEOUT_MS) || 60_000,
    maxRetries: 1,
  };
}

export function describeAIConfig(env: NodeJS.ProcessEnv = process.env): AIConfig {
  const settings = readProviderSettings(env);
  const verifier = readVerifierSettings(env);
  if (!settings) {
    return {
      configured: false,
      provider: 'none',
      model: '',
      verifierConfigured: false,
    };
  }
  return {
    configured: true,
    provider: settings.provider,
    model: settings.model,
    ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    verifierConfigured: Boolean(verifier),
    ...(verifier ? { verifierProvider: verifier.provider, verifierModel: verifier.model } : {}),
  };
}

function sleepDefault(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyStatus(status: number): AIProviderError {
  if (status === 401 || status === 403) {
    return new AIProviderError('INVALID_KEY', 'The AI provider rejected the configured API key.', { status });
  }
  if (status === 429) {
    return new AIProviderError('RATE_LIMIT', 'The AI provider rate limit was reached. Try again shortly.', {
      retryable: true,
      status,
    });
  }
  if (status === 408) {
    return new AIProviderError('TIMEOUT', 'The AI provider timed out.', { retryable: true, status });
  }
  if (status >= 500) {
    return new AIProviderError('PROVIDER_UNAVAILABLE', 'The AI provider is temporarily unavailable.', {
      retryable: true,
      status,
    });
  }
  if (status === 400 || status === 422) {
    return new AIProviderError('BAD_REQUEST', 'The AI provider rejected the request.', { status });
  }
  return new AIProviderError('PROVIDER_UNAVAILABLE', 'The AI provider request failed.', { status });
}

function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return body.trim();
  return body.slice(start, end + 1).trim();
}

/** Parses a JSON object from a model response, tolerating markdown fences. */
export function parseJsonObject(text: string): unknown {
  const candidate = extractJsonText(text);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new AIProviderError('INVALID_RESPONSE', 'The AI provider returned malformed JSON.');
  }
}

/**
 * Creates a provider client. OpenAI-compatible endpoints (OpenAI, Groq,
 * OpenRouter, local Ollama/LM Studio) share one adapter; Anthropic has its own.
 */
export function createProvider(
  settings: ProviderSettings,
  deps: CreateProviderDeps = {},
): ProviderClient {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? sleepDefault;
  const retryDelayMs = deps.retryDelayMs ?? 400;

  async function requestOnce(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? settings.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort);

    try {
      if (settings.provider === 'mock') {
        throw new AIProviderError('PROVIDER_UNAVAILABLE', 'Mock provider has no network implementation.');
      }

      if (settings.provider === 'anthropic') {
        const system = messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n\n');
        const userMessages = messages.filter((m) => m.role !== 'system');
        const response = await fetchImpl(`${settings.baseUrl}/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': settings.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: settings.model,
            max_tokens: options.maxTokens ?? settings.maxTokens,
            temperature: options.temperature ?? 0.2,
            ...(system ? { system } : {}),
            messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
          signal: controller.signal,
        });

        if (!response.ok) throw classifyStatus(response.status);
        const data = (await response.json()) as {
          content?: { type?: string; text?: string }[];
        };
        const text = (data.content ?? [])
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n')
          .trim();
        if (!text) throw new AIProviderError('INVALID_RESPONSE', 'The AI provider returned an empty response.');
        return text;
      }

      // OpenAI-compatible chat completions.
      const body: Record<string, unknown> = {
        model: settings.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? settings.maxTokens,
      };
      if (options.json !== false) body.response_format = { type: 'json_object' };

      let response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      // Some OpenAI-compatible providers do not support response_format.
      if (response.status === 400 && options.json !== false) {
        delete body.response_format;
        response = await fetchImpl(`${settings.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${settings.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      if (!response.ok) throw classifyStatus(response.status);
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AIProviderError('INVALID_RESPONSE', 'The AI provider returned an empty response.');
      return text;
    } catch (err) {
      if (err instanceof AIProviderError) throw err;
      if (options.signal?.aborted) {
        throw new AIProviderError('CANCELLED', 'The AI request was cancelled.');
      }
      if (controller.signal.aborted) {
        throw new AIProviderError('TIMEOUT', 'The AI provider timed out.', { retryable: true });
      }
      throw new AIProviderError('PROVIDER_UNAVAILABLE', 'Could not reach the AI provider.', {
        retryable: true,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    name: settings.provider,
    model: settings.model,
    async chat(messages, options = {}) {
      const attempts = Math.max(0, settings.maxRetries);
      let lastError: AIProviderError | null = null;
      for (let attempt = 0; attempt <= attempts; attempt++) {
        try {
          return await requestOnce(messages, options);
        } catch (err) {
          const providerError =
            err instanceof AIProviderError
              ? err
              : new AIProviderError('PROVIDER_UNAVAILABLE', 'The AI provider request failed.');
          lastError = providerError;
          if (!providerError.retryable || attempt === attempts) throw providerError;
          await sleep(retryDelayMs * 2 ** attempt);
        }
      }
      throw lastError ?? new AIProviderError('PROVIDER_UNAVAILABLE', 'The AI provider request failed.');
    },
  };
}

let cachedProvider: ProviderClient | null | undefined;
let cachedVerifier: ProviderClient | null | undefined;
let testProvider: ProviderClient | null | undefined;
let testVerifier: ProviderClient | null | undefined;

/** Returns the configured provider, or null when no key is configured. */
export function getProvider(): ProviderClient | null {
  if (testProvider !== undefined) return testProvider;
  if (cachedProvider !== undefined) return cachedProvider;
  const settings = readProviderSettings();
  cachedProvider = settings ? createProvider(settings) : null;
  return cachedProvider;
}

/** Optional genuinely-different verifier model. Null when not configured. */
export function getVerifierProvider(): ProviderClient | null {
  if (testVerifier !== undefined) return testVerifier;
  if (cachedVerifier !== undefined) return cachedVerifier;
  const settings = readVerifierSettings();
  cachedVerifier = settings ? createProvider(settings) : null;
  return cachedVerifier;
}

/** Test hook: inject a mock provider without network access. */
export function setProviderForTests(
  provider: ProviderClient | null | undefined,
  verifier: ProviderClient | null | undefined = undefined,
): void {
  testProvider = provider;
  testVerifier = verifier;
}

export function resetProviderCache(): void {
  cachedProvider = undefined;
  cachedVerifier = undefined;
  testProvider = undefined;
  testVerifier = undefined;
}

/** Safe message for clients. Never includes keys, raw bodies, or document content. */
export function publicAIError(err: unknown): { code: string; message: string } {
  if (err instanceof AIProviderError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'AI_ERROR', message: 'The AI request could not be completed.' };
}
