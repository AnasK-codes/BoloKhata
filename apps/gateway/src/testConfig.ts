import { loadConfig, type GatewayConfig } from './config';

/** Minimal valid environment for tests. Not a real secret. */
export const TEST_ENV: Record<string, string> = {
  GNANI_API_KEY: 'test-key',
  SESSION_TOKEN_SECRET: 'test-secret-0123456789',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'info',
  // Safe by default: nothing a test builds can reach the real Gnani API, even if it forgets to
  // point at a mock. Port 9 (discard) refuses connections.
  GNANI_STT_URL: 'ws://127.0.0.1:9/stt/v3/stream',
  GNANI_TTS_URL: 'ws://127.0.0.1:9/api/v1/tts',
};

export function testConfig(overrides: Record<string, string> = {}): GatewayConfig {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
