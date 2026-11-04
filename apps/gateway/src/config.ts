import { z } from 'zod';

/**
 * Gateway configuration, validated once at startup (fail fast).
 * Error messages name the variable and the problem but never print values, so a
 * misconfigured secret cannot leak into logs.
 */

// `FOO=` in a .env file arrives as an empty string; treat it as "not set".
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optionalString = z.preprocess(blankToUndefined, z.string().min(1).optional());
const wsUrl = z.string().regex(/^wss?:\/\/\S+$/, 'must be a ws:// or wss:// URL');

const TTS_SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];

const envSchema = z
  .object({
    GNANI_API_KEY: z.string().min(1),
    SUPABASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
    SUPABASE_ANON_KEY: optionalString,
    ACCOUNT_AUTH_REQUIRED: z.enum(['true', 'false']).default('false'),
    GNANI_STT_URL: wsUrl.default('wss://api.vachana.ai/stt/v3/stream'),
    GNANI_TTS_URL: wsUrl.default('wss://api.vachana.ai/api/v1/tts'),

    GNANI_STT_MODEL: z.enum(['prisma-v3.0', 'prisma-v2.5']).default('prisma-v3.0'),
    GNANI_STT_LANGUAGE: z.string().min(1).default('indic-auto'),
    GNANI_STT_FORMAT: z
      .enum(['verbatim', 'transcribe', 'codemix', 'transliterate'])
      .default('verbatim'),
    GNANI_STT_VAD_THRESHOLD: z.coerce.number().min(0).max(1).default(0.7),
    GNANI_STT_MIN_SILENCE_MS: z.coerce.number().int().min(100).max(2000).default(500),
    GNANI_STT_MIN_SPEECH_MS: z.coerce.number().int().min(50).max(2000).default(100),
    // Keep this low: a high value silently drops one-word answers like "haan" and "nahi".
    GNANI_STT_MIN_SEGMENT_MS: z.coerce.number().int().min(100).max(1000).default(120),
    // Connection strategy is unmeasured until the spike runs (docs/LATENCY.md); switchable here.
    GNANI_STT_STRATEGY: z.enum(['persistent', 'spare']).default('persistent'),
    GNANI_STT_IDLE_TIMEOUT_SEC: z.coerce.number().int().min(5).max(900).default(900),
    // Gnani caps a session at 15 minutes; rotate well before.
    GNANI_STT_ROTATE_AFTER_MIN: z.coerce.number().min(0.05).max(14).default(13),
    // 'paced' keeps the documented cadence on release; 'burst' sends the backlog at once.
    STT_DRAIN: z.enum(['paced', 'burst']).default('paced'),
    MAX_UTTERANCE_SECONDS: z.coerce.number().int().min(2).max(60).default(30),

    GNANI_TTS_MODEL: z.enum(['timbre-v2.5', 'timbre-v3.0']).default('timbre-v2.5'),
    GNANI_TTS_VOICE: z.string().min(1).default('Nalini'),
    GNANI_TTS_LANGUAGE: z.string().min(1).default('hi-IN'),
    GNANI_TTS_SAMPLE_RATE: z.coerce
      .number()
      .refine((n) => TTS_SAMPLE_RATES.includes(n), {
        message: `must be one of ${TTS_SAMPLE_RATES.join(', ')}`,
      })
      .default(24000),
    GNANI_TTS_CACHE_DIR: z.string().min(1).default('.tts-cache'),
    TTS_CACHE_MEMORY_MB: z.coerce.number().min(0).max(256).default(16),

    LLM_PROVIDER: z.enum(['bedrock', 'openai-compatible', 'none']).default('none'),
    AWS_REGION: z.string().min(1).default('ap-south-1'),
    BEDROCK_MODEL_ID: optionalString,
    // For LLM_PROVIDER=openai-compatible: any server that speaks POST {base}/chat/completions.
    OPENAI_BASE_URL: optionalString,
    OPENAI_API_KEY: optionalString,
    OPENAI_MODEL: optionalString,
    // 'always' sends every utterance to the model first; 'fallback' only when the rules are unsure.
    LLM_MODE: z.enum(['fallback', 'always']).default('fallback'),
    LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1200),

    ALLOWED_ORIGINS: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    SESSION_TOKEN_SECRET: z.string().min(16),
    DEMO_ACCESS_CODE: optionalString,
    MAX_SESSIONS: z.coerce.number().int().min(1).max(100).default(3),
    MAX_SESSION_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
    DAILY_STT_SECONDS_CAP: z.coerce.number().int().min(0).default(1800),
    DAILY_TTS_CHARS_CAP: z.coerce.number().int().min(0).default(20_000),
    SESSION_RATE_PER_IP_PER_MIN: z.coerce.number().int().min(1).default(10),
    SESSION_RATE_GLOBAL_PER_MIN: z.coerce.number().int().min(1).default(60),
    METRICS_TOKEN: optionalString,
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    DRAIN_TIMEOUT_MS: z.coerce.number().int().min(0).max(60_000).default(10_000),

    PORT: z.coerce.number().int().min(1).max(65_535).default(8080),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.ACCOUNT_AUTH_REQUIRED === 'true' || env.SUPABASE_URL || env.SUPABASE_ANON_KEY) {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'SUPABASE_URL and SUPABASE_ANON_KEY are both required for account authentication' });
      if (env.SUPABASE_URL && !env.SUPABASE_URL.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(env.SUPABASE_URL)) ctx.addIssue({ code: 'custom', path: ['SUPABASE_URL'], message: 'use HTTPS (HTTP is allowed only for local tests)' });
    }
    if (env.LLM_PROVIDER === 'bedrock' && !env.BEDROCK_MODEL_ID) {
      ctx.addIssue({
        code: 'custom',
        path: ['BEDROCK_MODEL_ID'],
        message: 'required when LLM_PROVIDER=bedrock (or set LLM_PROVIDER=none)',
      });
    }
    if (env.LLM_PROVIDER === 'openai-compatible') {
      for (const name of ['OPENAI_BASE_URL', 'OPENAI_MODEL'] as const) {
        if (!env[name]) {
          ctx.addIssue({
            code: 'custom',
            path: [name],
            message: 'required when LLM_PROVIDER=openai-compatible (or set LLM_PROVIDER=none)',
          });
        }
      }
    }
  });

export interface GatewayConfig {
  accountAuth: { url: string; key: string } | null;
  gnani: {
    apiKey: string;
    stt: {
      url: string;
      model: 'prisma-v3.0' | 'prisma-v2.5';
      language: string;
      format: 'verbatim' | 'transcribe' | 'codemix' | 'transliterate';
      vadThreshold: number;
      minSilenceMs: number;
      minSpeechMs: number;
      minSegmentMs: number;
      strategy: 'persistent' | 'spare';
      idleTimeoutSec: number;
      rotateAfterMs: number;
      drain: 'paced' | 'burst';
      maxUtteranceSeconds: number;
    };
    tts: {
      url: string;
      model: 'timbre-v2.5' | 'timbre-v3.0';
      voice: string;
      language: string;
      sampleRate: number;
      cacheDir: string;
      cacheMemoryBytes: number;
    };
  };
  llm: {
    provider: 'bedrock' | 'openai-compatible' | 'none';
    awsRegion: string;
    bedrockModelId: string | undefined;
    openai: { baseUrl: string | undefined; apiKey: string | undefined; model: string | undefined };
    timeoutMs: number;
    mode: 'fallback' | 'always';
  };
  guard: {
    allowedOrigins: string[];
    sessionTokenSecret: string;
    demoAccessCode: string | undefined;
    maxSessions: number;
    maxSessionMinutes: number;
    dailySttSecondsCap: number;
    dailyTtsCharsCap: number;
    sessionRatePerIpPerMin: number;
    sessionRateGlobalPerMin: number;
    metricsToken: string | undefined;
  };
  server: { port: number; logLevel: string; trustProxy: boolean; drainTimeoutMs: number };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): GatewayConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((issue) => {
      const name = issue.path.length > 0 ? issue.path.join('.') : 'environment';
      return `  - ${name}: ${issue.message}`;
    });
    throw new ConfigError(
      `Invalid gateway configuration. Fix these environment variables (see .env.example):\n${lines.join('\n')}`,
    );
  }
  const e = parsed.data;
  return {
    accountAuth: e.SUPABASE_URL && e.SUPABASE_ANON_KEY ? { url: e.SUPABASE_URL.replace(/\/$/, ''), key: e.SUPABASE_ANON_KEY } : null,
    gnani: {
      apiKey: e.GNANI_API_KEY,
      stt: {
        url: e.GNANI_STT_URL,
        model: e.GNANI_STT_MODEL,
        language: e.GNANI_STT_LANGUAGE,
        format: e.GNANI_STT_FORMAT,
        vadThreshold: e.GNANI_STT_VAD_THRESHOLD,
        minSilenceMs: e.GNANI_STT_MIN_SILENCE_MS,
        minSpeechMs: e.GNANI_STT_MIN_SPEECH_MS,
        minSegmentMs: e.GNANI_STT_MIN_SEGMENT_MS,
        strategy: e.GNANI_STT_STRATEGY,
        idleTimeoutSec: e.GNANI_STT_IDLE_TIMEOUT_SEC,
        rotateAfterMs: Math.round(e.GNANI_STT_ROTATE_AFTER_MIN * 60_000),
        drain: e.STT_DRAIN,
        maxUtteranceSeconds: e.MAX_UTTERANCE_SECONDS,
      },
      tts: {
        url: e.GNANI_TTS_URL,
        model: e.GNANI_TTS_MODEL,
        voice: e.GNANI_TTS_VOICE,
        language: e.GNANI_TTS_LANGUAGE,
        sampleRate: e.GNANI_TTS_SAMPLE_RATE,
        cacheDir: e.GNANI_TTS_CACHE_DIR,
        cacheMemoryBytes: Math.round(e.TTS_CACHE_MEMORY_MB * 1024 * 1024),
      },
    },
    llm: {
      provider: e.LLM_PROVIDER,
      awsRegion: e.AWS_REGION,
      bedrockModelId: e.BEDROCK_MODEL_ID,
      openai: { baseUrl: e.OPENAI_BASE_URL, apiKey: e.OPENAI_API_KEY, model: e.OPENAI_MODEL },
      timeoutMs: e.LLM_TIMEOUT_MS,
      mode: e.LLM_MODE,
    },
    guard: {
      allowedOrigins: e.ALLOWED_ORIGINS,
      sessionTokenSecret: e.SESSION_TOKEN_SECRET,
      demoAccessCode: e.DEMO_ACCESS_CODE,
      maxSessions: e.MAX_SESSIONS,
      maxSessionMinutes: e.MAX_SESSION_MINUTES,
      dailySttSecondsCap: e.DAILY_STT_SECONDS_CAP,
      dailyTtsCharsCap: e.DAILY_TTS_CHARS_CAP,
      sessionRatePerIpPerMin: e.SESSION_RATE_PER_IP_PER_MIN,
      sessionRateGlobalPerMin: e.SESSION_RATE_GLOBAL_PER_MIN,
      metricsToken: e.METRICS_TOKEN,
    },
    server: {
      port: e.PORT,
      logLevel: e.LOG_LEVEL,
      trustProxy: e.TRUST_PROXY,
      drainTimeoutMs: e.DRAIN_TIMEOUT_MS,
    },
  };
}
