import { loadConfig, type GatewayConfig } from './config';

/** Minimal valid environment for tests. Not a real secret. */
export const TEST_ENV: Record<string, string> = {
  GNANI_API_KEY: 'test-key',
  SESSION_TOKEN_SECRET: 'test-secret-0123456789',
  ALLOWED_ORIGINS: 'http://localhost:3000',
  LOG_LEVEL: 'info',
};

export function testConfig(overrides: Record<string, string> = {}): GatewayConfig {
  return loadConfig({ ...TEST_ENV, ...overrides });
}
