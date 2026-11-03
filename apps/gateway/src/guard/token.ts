import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, single-use session tokens: `<id>.<expiryMs>.<hmac>`.
 * Single use is enforced in memory, which is enough for one gateway process.
 */
export interface TokenService {
  issue(): { token: string; expiresInSec: number };
  /** True exactly once for a valid, unexpired token. */
  consume(token: string): boolean;
}

export const TOKEN_TTL_MS = 120_000;

export function createTokenService(
  secret: string,
  ttlMs: number = TOKEN_TTL_MS,
  now: () => number = Date.now,
): TokenService {
  const used = new Map<string, number>();

  const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

  const purge = () => {
    const t = now();
    for (const [id, expiry] of used) if (expiry <= t) used.delete(id);
  };

  return {
    issue() {
      purge();
      const id = randomBytes(12).toString('base64url');
      const expiry = now() + ttlMs;
      const payload = `${id}.${expiry}`;
      return { token: `${payload}.${sign(payload)}`, expiresInSec: Math.round(ttlMs / 1000) };
    },
    consume(token) {
      if (token.length > 200) return false;
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      const [id, expiryText, signature] = parts as [string, string, string];
      const expected = Buffer.from(sign(`${id}.${expiryText}`));
      const actual = Buffer.from(signature);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
      const expiry = Number(expiryText);
      if (!Number.isFinite(expiry) || expiry <= now()) return false;
      purge();
      if (used.has(id)) return false;
      used.set(id, expiry);
      return true;
    },
  };
}
