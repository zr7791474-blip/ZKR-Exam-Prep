import { describe, expect, it, vi } from 'vitest';
import {
  AIProviderError,
  createProvider,
  describeAIConfig,
  parseJsonObject,
  publicAIError,
  readProviderSettings,
  readVerifierSettings,
  type ProviderSettings,
} from './provider';

const baseSettings: ProviderSettings = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'gpt-test',
  baseUrl: 'https://example.test/v1',
  maxTokens: 128,
  timeoutMs: 5000,
  maxRetries: 0,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe('readProviderSettings', () => {
  it('supports an explicit mock provider without a real key', () => {
    const settings = readProviderSettings(env({ AI_PROVIDER: 'mock', AI_MODEL: 'my-model' }));
    expect(settings).toMatchObject({ provider: 'mock', apiKey: 'mock', model: 'my-model' });
  });

  it('detects an OpenAI key and applies defaults', () => {
    const settings = readProviderSettings(env({ OPENAI_API_KEY: 'sk-test' }));
    expect(settings).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });
  });

  it('detects an Anthropic key and uses its default model', () => {
    const settings = readProviderSettings(
      env({ ANTHROPIC_API_KEY: 'ak-test', AI_MODEL: 'claude-test' }),
    );
    expect(settings).toMatchObject({
      provider: 'anthropic',
      apiKey: 'ak-test',
      model: 'claude-test',
      baseUrl: 'https://api.anthropic.com/v1',
    });
  });

  it('returns null when a provider is selected but no key exists', () => {
    expect(readProviderSettings(env({ AI_PROVIDER: 'anthropic' }))).toBeNull();
    expect(readProviderSettings(env({}))).toBeNull();
  });
});

describe('readVerifierSettings and describeAIConfig', () => {
  it('requires an explicit verifier model', () => {
    expect(readVerifierSettings(env({ AI_API_KEY: 'sk-test' }))).toBeNull();
  });

  it('builds a verifier client from the primary key', () => {
    const settings = readVerifierSettings(
      env({ AI_API_KEY: 'sk-test', AI_VERIFIER_MODEL: 'gpt-verifier' }),
    );
    expect(settings).toMatchObject({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-verifier',
    });
  });

  it('supports a mock verifier', () => {
    const settings = readVerifierSettings(
      env({ AI_VERIFIER_PROVIDER: 'mock', AI_VERIFIER_MODEL: 'mock-verifier' }),
    );
    expect(settings).toMatchObject({ provider: 'mock', model: 'mock-verifier' });
  });

  it('describes configured and unconfigured states without exposing keys', () => {
    expect(describeAIConfig(env({}))).toMatchObject({
      configured: false,
      provider: 'none',
      verifierConfigured: false,
    });

    const config = describeAIConfig(
      env({ OPENAI_API_KEY: 'sk-secret', AI_VERIFIER_MODEL: 'gpt-verifier' }),
    );
    expect(config).toMatchObject({
      configured: true,
      provider: 'openai',
      verifierConfigured: true,
      verifierModel: 'gpt-verifier',
    });
    expect(JSON.stringify(config)).not.toContain('sk-secret');
  });
});

describe('parseJsonObject', () => {
  it('parses plain JSON and fenced JSON', () => {
    expect(parseJsonObject('{"answer":"A"}')).toEqual({ answer: 'A' });
    expect(parseJsonObject('```json\n{"answer":"B"}\n```')).toEqual({ answer: 'B' });
  });

  it('rejects malformed JSON with a safe provider error', () => {
    try {
      parseJsonObject('not json');
      throw new Error('expected parseJsonObject to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AIProviderError);
      expect((error as AIProviderError).code).toBe('INVALID_RESPONSE');
    }
  });
});

describe('createProvider', () => {
  it('calls an OpenAI-compatible endpoint and returns message content', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"answer":"A"}' } }] }),
    );
    const client = createProvider(baseSettings, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const text = await client.chat([{ role: 'user', content: 'hello' }]);
    expect(text).toBe('{"answer":"A"}');
    expect(client.name).toBe('openai');
    expect(client.model).toBe('gpt-test');

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://example.test/v1/chat/completions');
    expect((calls[0][1].headers as Record<string, string>).authorization).toBe('Bearer test-key');
  });

  it('calls the Anthropic messages endpoint with the right headers', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ content: [{ type: 'text', text: 'hello' }] }),
    );
    const client = createProvider(
      { ...baseSettings, provider: 'anthropic', baseUrl: 'https://anthropic.test/v1' },
      { fetchImpl: fetchMock as unknown as typeof fetch },
    );

    const text = await client.chat([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hello' },
    ]);
    expect(text).toBe('hello');

    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe('https://anthropic.test/v1/messages');
    const headers = calls[0][1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('maps an authentication failure to INVALID_KEY', async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    const client = createProvider(baseSettings, {
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
  });

  it('retries a retryable provider failure once', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: 'recovered' } }] }),
    );

    const client = createProvider(
      { ...baseSettings, maxRetries: 1 },
      {
        fetchImpl: fetchMock as unknown as typeof fetch,
        sleep: async () => undefined,
        retryDelayMs: 0,
      },
    );

    await expect(client.chat([{ role: 'user', content: 'hello' }])).resolves.toBe('recovered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never performs network calls for the mock provider', async () => {
    const client = createProvider({ ...baseSettings, provider: 'mock' });
    await expect(client.chat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });
});

describe('publicAIError', () => {
  it('returns safe codes and messages without raw details', () => {
    expect(publicAIError(new AIProviderError('TIMEOUT', 'The AI provider timed out.'))).toEqual({
      code: 'TIMEOUT',
      message: 'The AI provider timed out.',
    });
    expect(publicAIError(new Error('secret stack trace'))).toEqual({
      code: 'AI_ERROR',
      message: 'The AI request could not be completed.',
    });
  });
});
