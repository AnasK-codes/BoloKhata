import { readFileSync } from 'node:fs';
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
    // The shared test environment points Gnani at a closed local port; the real defaults are
    // checked by leaving those two variables out.
    const { GNANI_STT_URL: _stt, GNANI_TTS_URL: _tts, ...withoutUrls } = TEST_ENV;
    const config = loadConfig(withoutUrls);
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

  it('starts from a copy of .env.example once the account URL and key are filled', () => {
    const example = Object.fromEntries(
      readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => /^[A-Z_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    const config = loadConfig({ ...example, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    expect(config.llm.openai.reasoningEffort).toBeUndefined();
  });

  describe('PARSER_MODE', () => {
    it('defaults to rules_ai, so today\'s behaviour is unchanged', () => {
      expect(testConfig().llm.parserMode).toBe('rules_ai');
      expect(testConfig({ PARSER_MODE: '' }).llm.parserMode).toBe('rules_ai');
    });

    it('ai_only needs a model: it fails fast with LLM_PROVIDER=none', () => {
      expect(() => testConfig({ PARSER_MODE: 'ai_only' })).toThrow(/PARSER_MODE/);
      const ok = testConfig({ PARSER_MODE: 'ai_only', LLM_PROVIDER: 'openai-compatible', OPENAI_BASE_URL: 'https://llm.test/v1', OPENAI_MODEL: 'm' });
      expect(ok.llm.parserMode).toBe('ai_only');
    });

    it('rejects an unknown mode', () => {
      expect(() => testConfig({ PARSER_MODE: 'magic' })).toThrow(/PARSER_MODE/);
    });
  });

  describe('in production (NODE_ENV=production)', () => {
    const prod = {
      NODE_ENV: 'production',
      GNANI_API_KEY: 'real-looking-key',
      SESSION_TOKEN_SECRET: 'a'.repeat(64),
      ALLOWED_ORIGINS: 'https://shop.example.test',
    };

    it('accepts a complete HTTPS configuration', () => {
      expect(testConfig(prod).guard.allowedOrigins).toEqual(['https://shop.example.test']);
    });

    it('rejects the placeholder or a short session secret', () => {
      expect(() => testConfig({ ...prod, SESSION_TOKEN_SECRET: 'replace-with-a-long-random-string' })).toThrow(/SESSION_TOKEN_SECRET/);
      expect(() => testConfig({ ...prod, SESSION_TOKEN_SECRET: 'x'.repeat(20) })).toThrow(/SESSION_TOKEN_SECRET/);
    });

    it('rejects the placeholder Gnani key', () => {
      expect(() => testConfig({ ...prod, GNANI_API_KEY: 'replace-me' })).toThrow(/GNANI_API_KEY/);
    });

    it('rejects a non-HTTPS origin', () => {
      expect(() => testConfig({ ...prod, ALLOWED_ORIGINS: 'http://shop.example.test' })).toThrow(/ALLOWED_ORIGINS/);
    });
  });
});

describe('DEMO_NO_AUTH (temporary demo switch)', () => {
  const withAuth = { ...TEST_ENV, ACCOUNT_AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://auth.example.test', SUPABASE_ANON_KEY: 'synthetic-anon-key' };

  it('is off by default, and then login stays on when Supabase is configured', () => {
    const config = loadConfig(withAuth);
    expect(config.demoNoAuth).toBe(false);
    expect(config.accountAuth).not.toBeNull();
  });

  it('turns account checking off even when Supabase is configured', () => {
    const config = loadConfig({ ...withAuth, DEMO_NO_AUTH: 'true' });
    expect(config.demoNoAuth).toBe(true);
    expect(config.accountAuth).toBeNull();
  });

  it('lets the gateway start with login "required" but no Supabase, only in demo mode', () => {
    const noKeys = { ...TEST_ENV, ACCOUNT_AUTH_REQUIRED: 'true' };
    expect(() => loadConfig(noKeys)).toThrow(ConfigError);
    expect(loadConfig({ ...noKeys, DEMO_NO_AUTH: 'true' }).accountAuth).toBeNull();
  });

  it('accepts only true or false', () => {
    expect(messageOf(() => loadConfig({ ...TEST_ENV, DEMO_NO_AUTH: 'yes' }))).toContain('DEMO_NO_AUTH');
  });
});
