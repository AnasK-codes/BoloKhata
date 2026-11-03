import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';
import { TEST_ENV, testConfig } from './testConfig';

function messageOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = testConfig();
    expect(config.gnani.stt.url).toBe('wss://api.vachana.ai/stt/v3/stream');
    expect(config.gnani.tts.url).toBe('wss://api.vachana.ai/api/v1/tts');
    expect(config.gnani.stt.model).toBe('prisma-v3.0');
    expect(config.gnani.tts.sampleRate).toBe(24000);
    expect(config.llm.provider).toBe('none');
    expect(config.llm.timeoutMs).toBe(1200);
    expect(config.server.port).toBe(8080);
  });

  it('can point at the mock servers', () => {
    const config = testConfig({
      GNANI_STT_URL: 'ws://127.0.0.1:9101/stt/v3/stream',
      GNANI_TTS_URL: 'ws://127.0.0.1:9102/api/v1/tts',
    });
    expect(config.gnani.stt.url).toBe('ws://127.0.0.1:9101/stt/v3/stream');
    expect(config.gnani.tts.url).toBe('ws://127.0.0.1:9102/api/v1/tts');
  });

  it('parses a comma separated origin allowlist', () => {
    const config = testConfig({ ALLOWED_ORIGINS: 'http://a.test, https://b.test' });
    expect(config.guard.allowedOrigins).toEqual(['http://a.test', 'https://b.test']);
  });

  it('treats blank optional variables as unset', () => {
    const config = testConfig({ DEMO_ACCESS_CODE: '', BEDROCK_MODEL_ID: '' });
    expect(config.guard.demoAccessCode).toBeUndefined();
    expect(config.llm.bedrockModelId).toBeUndefined();
  });

  it('fails fast with a readable message listing every bad variable', () => {
    const rest: Record<string, string> = { ...TEST_ENV };
    delete rest['GNANI_API_KEY'];
    const message = messageOf(() => loadConfig({ ...rest, PORT: 'abc', SESSION_TOKEN_SECRET: 'short' }));
    expect(message).toContain('GNANI_API_KEY');
    expect(message).toContain('PORT');
    expect(message).toContain('SESSION_TOKEN_SECRET');
  });

  it('never echoes secret values in error messages', () => {
    const message = messageOf(() => testConfig({ SESSION_TOKEN_SECRET: 'tiny-secret' }));
    expect(message).not.toContain('tiny-secret');
  });

  it('requires a model id for bedrock', () => {
    expect(() => testConfig({ LLM_PROVIDER: 'bedrock' })).toThrow(/BEDROCK_MODEL_ID/);
    const ok = testConfig({ LLM_PROVIDER: 'bedrock', BEDROCK_MODEL_ID: 'some-model' });
    expect(ok.llm.provider).toBe('bedrock');
  });

  it('rejects non-websocket Gnani URLs and unsupported sample rates', () => {
    expect(() => testConfig({ GNANI_STT_URL: 'https://example.test' })).toThrow(/GNANI_STT_URL/);
    expect(() => testConfig({ GNANI_TTS_SAMPLE_RATE: '12345' })).toThrow(/GNANI_TTS_SAMPLE_RATE/);
  });
});
