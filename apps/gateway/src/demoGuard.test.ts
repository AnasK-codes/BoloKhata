import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import { testConfig } from './testConfig';
import { HELLO, TEST_ORIGIN, startGateway, type Harness } from './testing/harness';

/**
 * One test per demo-guard limit, so each is proven on its own. (The access code, the origin
 * allowlist, the STT-seconds and TTS-characters caps at the turn level, and the "busy" socket
 * close have further tests in session/session.test.ts and gateway.e2e.test.ts; docs/TESTING.md
 * maps every limit to its tests.)
 */
let gateway: Harness | undefined;
let mock: MockGnani | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await gateway?.close();
  gateway = undefined;
  await mock?.close();
  mock = undefined;
});

const post = (g: Harness, ip: string) =>
  fetch(`${g.baseUrl}/session`, { method: 'POST', headers: { origin: TEST_ORIGIN, 'x-forwarded-for': ip } });

describe('rate limits on POST /session', () => {
  it('per IP: the third request in a minute is refused with a retry time, another IP is unaffected', async () => {
    gateway = await startGateway({ TRUST_PROXY: 'true', SESSION_RATE_PER_IP_PER_MIN: '2' });
    expect((await post(gateway, '203.0.113.1')).status).toBe(200);
    expect((await post(gateway, '203.0.113.1')).status).toBe(200);
    const refused = await post(gateway, '203.0.113.1');
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await refused.json()).toMatchObject({ type: 'limit', reason: 'rate_limited' });
    expect((await post(gateway, '203.0.113.2')).status).toBe(200);
  });

  it('counts wrong access codes against the per-IP limit, so the code cannot be guessed at speed', async () => {
    gateway = await startGateway({ TRUST_PROXY: 'true', SESSION_RATE_PER_IP_PER_MIN: '2', DEMO_ACCESS_CODE: 'right-code' });
    const guess = (code: string) =>
      fetch(`${gateway!.baseUrl}/session`, {
        method: 'POST',
        headers: { origin: TEST_ORIGIN, 'x-forwarded-for': '203.0.113.9', 'content-type': 'application/json' },
        body: JSON.stringify({ accessCode: code }),
      });
    expect((await guess('wrong-1')).status).toBe(403);
    expect((await guess('wrong-2')).status).toBe(403);
    expect((await guess('right-code')).status).toBe(429);
  });

  it('globally: once the whole demo hits its per-minute cap, every IP is refused', async () => {
    gateway = await startGateway({ TRUST_PROXY: 'true', SESSION_RATE_PER_IP_PER_MIN: '100', SESSION_RATE_GLOBAL_PER_MIN: '3' });
    for (const ip of ['203.0.113.11', '203.0.113.12', '203.0.113.13']) expect((await post(gateway, ip)).status).toBe(200);
    const refused = await post(gateway, '203.0.113.14');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ reason: 'rate_limited' });
  });

  it('ignores a forged X-Forwarded-For when the gateway is not behind a trusted proxy', async () => {
    gateway = await startGateway({ SESSION_RATE_PER_IP_PER_MIN: '2' });
    await post(gateway, '1.1.1.1');
    await post(gateway, '2.2.2.2');
    expect((await post(gateway, '3.3.3.3')).status).toBe(429); // all three are the same real client
  });
});

describe('X-Forwarded-For behind the proxy', () => {
  it('uses the address the proxy appended, so a client cannot dodge the limit by forging the front of the header', async () => {
    gateway = await startGateway({ TRUST_PROXY: 'true', SESSION_RATE_PER_IP_PER_MIN: '2' });
    // "client-forged, address-the-proxy-saw": every request really comes from 203.0.113.99.
    expect((await post(gateway, 'forged-a, 203.0.113.99')).status).toBe(200);
    expect((await post(gateway, 'forged-b, 203.0.113.99')).status).toBe(200);
    expect((await post(gateway, 'forged-c, 203.0.113.99')).status).toBe(429);
  });
});

describe('MAX_SESSIONS', () => {
  it('a full demo answers POST /session with a friendly busy message and a retry time, then recovers', async () => {
    gateway = await startGateway({ MAX_SESSIONS: '1' });
    const first = await gateway.ready();
    const busy = await fetch(`${gateway.baseUrl}/session`, { method: 'POST', headers: { origin: TEST_ORIGIN } });
    expect(busy.status).toBe(503);
    expect(Number(busy.headers.get('retry-after'))).toBeGreaterThan(0);
    const body = (await busy.json()) as { type: string; reason: string; message: string; retryAfterSec: number };
    expect(body).toMatchObject({ type: 'limit', reason: 'busy' });
    expect(body.message).toMatch(/busy/i);
    expect(body.message).not.toMatch(/error|exception|stack/i);
    first.close();
    await new Promise((r) => setTimeout(r, 200));
    expect((await post(gateway, '127.0.0.1')).status).toBe(200);
  });
});

describe('the session time cap', () => {
  it('MAX_SESSION_MINUTES ends a session with a session_expired limit message and the 4001 close', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    gateway = await startGateway({ MAX_SESSION_MINUTES: '1' });
    const client = await gateway.ready(HELLO);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await client.next('limit')).toMatchObject({ reason: 'session_expired' });
    expect((await client.waitClosed()).code).toBe(4001);
    expect(gateway.app.gateway.sessions.size).toBe(0);
  });
});

describe('daily credit caps', () => {
  it('a spent TTS-characters cap turns POST /session into a budget message with a reset time, and the public sees nothing else', async () => {
    mock = await startMockGnani();
    gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url, DAILY_TTS_CHARS_CAP: '20', METRICS_TOKEN: 'm-secret' });
    const client = await gateway.ready(HELLO);
    client.sendJson({ type: 'speak', turnId: 1, text: 'Ek do teen char paan' }); // exactly 20 characters: spends the cap
    await client.next('tts_end');
    // One more is refused on the spot, with the same budget message.
    client.sendJson({ type: 'speak', turnId: 2, text: 'Aur ek' });
    expect(await client.next('limit')).toMatchObject({ reason: 'budget' });
    const refused = await fetch(`${gateway.baseUrl}/session`, { method: 'POST', headers: { origin: TEST_ORIGIN } });
    expect(refused.status).toBe(503);
    const body = (await refused.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ type: 'limit', reason: 'budget' });
    expect(Object.keys(body).sort()).toEqual(['message', 'reason', 'resetAt', 'type']); // no usage numbers
  });

  it('a DAILY_STT_SECONDS_CAP of 0 allows no speech at all', async () => {
    mock = await startMockGnani();
    gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url, DAILY_STT_SECONDS_CAP: '0' });
    const refused = await fetch(`${gateway.baseUrl}/session`, { method: 'POST', headers: { origin: TEST_ORIGIN } });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ reason: 'budget' });
  });
});

describe('what operators and the public can see', () => {
  it('/metrics shows the remaining budget and process health to the operator only', async () => {
    mock = await startMockGnani({ stt: { transcriptLatencyMs: 10 } });
    gateway = await startGateway({ GNANI_STT_URL: mock.stt.url, GNANI_TTS_URL: mock.tts.url, METRICS_TOKEN: 'm-secret', DAILY_STT_SECONDS_CAP: '600', DAILY_TTS_CHARS_CAP: '1000' });
    const client = await gateway.ready(HELLO);
    mock.stt.queueTranscripts('Sharma ji ka kitna udhaar hai');
    client.sendJson({ type: 'ptt_start', turnId: 1 });
    for (let i = 0; i < 20; i++) client.sendBinary(speechFrame());
    client.sendJson({ type: 'ptt_end', turnId: 1 });
    await client.next('tts_end');

    const res = await fetch(`${gateway.baseUrl}/metrics`, { headers: { authorization: 'Bearer m-secret' } });
    const metrics = (await res.json()) as { credits: Record<string, number>; runtime: Record<string, unknown> };
    expect(metrics.credits['stt_seconds_cap']).toBe(600);
    expect(metrics.credits['stt_seconds_remaining']).toBeLessThan(600);
    expect(metrics.credits['tts_chars_remaining']).toBeLessThan(1000);
    expect(metrics.runtime).toMatchObject({ rssMb: expect.any(Number), eventLoopDelayMs: { p99: expect.any(Number) } });

    for (const path of ['/healthz', '/session']) {
      const publicBody = JSON.stringify(await (await fetch(`${gateway.baseUrl}${path}`, { method: path === '/session' ? 'POST' : 'GET', headers: { origin: TEST_ORIGIN } })).json().catch(() => ({})));
      expect(publicBody).not.toMatch(/remaining|credits|tts_chars|stt_seconds/);
    }
    expect((await fetch(`${gateway.baseUrl}/metrics`)).status).toBe(401);
    expect((await fetch(`${gateway.baseUrl}/metrics`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
  });
});

describe('tests and dev never reach the real Gnani API', () => {
  it('the default test configuration points at a closed local port', () => {
    const config = testConfig();
    expect(config.gnani.stt.url).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    expect(config.gnani.tts.url).toMatch(/^ws:\/\/127\.0\.0\.1:/);
  });

  it('no test or mock file names the real Gnani host, and the mock env file is all local', () => {
    const root = join(__dirname, '../../..');
    const allowed = new Set(['config.test.ts', 'spike.test.ts', 'demoGuard.test.ts']); // these assert on the documented defaults
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.next') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.test\.tsx?$/.test(name) && !allowed.has(name) && /api\.vachana\.ai/.test(readFileSync(path, 'utf8'))) offenders.push(path);
      }
    };
    for (const dir of ['apps/gateway/src', 'apps/web/src', 'tools', 'packages', 'scripts/loadtest']) walk(join(root, dir));
    expect(offenders).toEqual([]);

    const mockEnv = readFileSync(join(root, 'apps/gateway/mock.env'), 'utf8');
    for (const line of mockEnv.split('\n').filter((l) => /^GNANI_(STT|TTS)_URL=/.test(l))) {
      expect(line).toMatch(/=ws:\/\/127\.0\.0\.1:/);
    }
    expect(mockEnv).toMatch(/GNANI_API_KEY=mock-key-not-real/);
  });
});
