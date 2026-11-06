import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DailyCreditGuard, FileCreditStore } from './creditGuard';
import { RateLimiter } from './rateLimit';
import { createTokenService } from './token';

describe('token service', () => {
  it('accepts a fresh token exactly once', () => {
    const tokens = createTokenService('secret-secret-secret');
    const { token } = tokens.issue();
    expect(tokens.consume(token)).toBe(true);
    expect(tokens.consume(token)).toBe(false);
  });

  it('rejects an expired token', () => {
    let now = 1_000;
    const tokens = createTokenService('secret-secret-secret', 120_000, () => now);
    const { token } = tokens.issue();
    now += 120_001;
    expect(tokens.consume(token)).toBe(false);
  });

  it('rejects a tampered signature, a tampered expiry and garbage', () => {
    const tokens = createTokenService('secret-secret-secret');
    const { token } = tokens.issue();
    const [id, expiry, signature] = token.split('.') as [string, string, string];
    expect(tokens.consume(`${id}.${expiry}.${signature.slice(0, -2)}xx`)).toBe(false);
    expect(tokens.consume(`${id}.${Number(expiry) + 60_000}.${signature}`)).toBe(false);
    expect(tokens.consume('')).toBe(false);
    expect(tokens.consume('a.b')).toBe(false);
    expect(tokens.consume('x'.repeat(500))).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const { token } = createTokenService('secret-one-0123456789').issue();
    expect(createTokenService('secret-two-0123456789').consume(token)).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows up to the limit then refuses with a retry time', () => {
    const now = 0;
    const limiter = new RateLimiter(2, 60_000, () => now);
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(true);
    const refused = limiter.take('a');
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBe(60);
  });

  it('tracks keys separately and resets after the window', () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1000, () => now);
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('b').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
    now = 1001;
    expect(limiter.take('a').ok).toBe(true);
  });
});

describe('credit guard', () => {
  const caps = { stt_seconds: 10, tts_chars: 100 };

  it('reserves under the cap and refuses over it', () => {
    const guard = new DailyCreditGuard(caps);
    expect(guard.checkAndReserve('stt_seconds', 6)).toBe(true);
    expect(guard.checkAndReserve('stt_seconds', 5)).toBe(false);
    expect(guard.checkAndReserve('stt_seconds', 4)).toBe(true);
    expect(guard.isExhausted()).toBe(true);
  });

  it('settles a reservation with the real usage', () => {
    const guard = new DailyCreditGuard(caps);
    guard.checkAndReserve('tts_chars', 50);
    guard.record('tts_chars', 20, 50);
    expect(guard.usage().tts_chars).toBe(20);
  });

  it('starts a new day at IST midnight', () => {
    // 2026-01-01T18:29:00Z is 23:59 IST on Jan 1; two minutes later it is Jan 2 in India.
    let now = Date.parse('2026-01-01T18:29:00Z');
    const guard = new DailyCreditGuard(caps, undefined, () => now);
    guard.checkAndReserve('stt_seconds', 10);
    expect(guard.isExhausted()).toBe(true);
    expect(guard.resetAt()).toBe('2026-01-01T18:30:00.000Z');
    now = Date.parse('2026-01-01T18:31:00Z');
    expect(guard.isExhausted()).toBe(false);
    expect(guard.usage().day).toBe('2026-01-02');
  });

  it('treats a cap of 0 as nothing allowed', () => {
    const guard = new DailyCreditGuard({ stt_seconds: 0, tts_chars: 0 });
    expect(guard.checkAndReserve('stt_seconds', 1)).toBe(false);
    expect(guard.isExhausted()).toBe(true);
  });
});

describe('file credit store', () => {
  const caps = { stt_seconds: 100, tts_chars: 1000 };

  it('keeps today\'s usage across a restart, so a redeploy does not reset the caps', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'credits-')), 'nested', 'credit-usage.json');
    const first = new FileCreditStore(file);
    const before = new DailyCreditGuard(caps, first, () => 0);
    expect(before.checkAndReserve('stt_seconds', 90)).toBe(true);
    before.record('tts_chars', 400, 0);
    await first.flush();

    const after = new DailyCreditGuard(caps, new FileCreditStore(file), () => 0);
    expect(after.usage()).toMatchObject({ stt_seconds: 90, tts_chars: 400 });
    expect(after.checkAndReserve('stt_seconds', 20)).toBe(false);
  });

  it('keeps only the current day and starts from zero on a missing or damaged file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'credits-'));
    const file = join(dir, 'credit-usage.json');
    expect(new FileCreditStore(file).get('2026-11-06', 'stt_seconds')).toBe(0);
    writeFileSync(file, '{not json');
    const store = new FileCreditStore(file);
    store.add('2026-11-05', 'stt_seconds', 10);
    store.add('2026-11-06', 'stt_seconds', 5);
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ '2026-11-06:stt_seconds': 5 });
  });
});
