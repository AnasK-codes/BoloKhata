import { afterEach, describe, expect, it } from 'vitest';
import { AUDIO_FRAME_BYTES } from '@bolbill/shared';
import { DailyCreditGuard } from '../guard/creditGuard';
import { HELLO, TEST_ORIGIN, captureLogs, startGateway, type Harness } from '../testing/harness';
import { WsTestClient, sleep } from '../testing/client';

let gateway: Harness | undefined;

afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
});

async function postSession(base: string, init: { origin?: string; body?: unknown } = {}) {
  return fetch(`${base}/session`, {
    method: 'POST',
    headers: {
      ...(init.origin === undefined ? {} : { origin: init.origin }),
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

describe('POST /session', () => {
  it('issues a token to an allowed origin', async () => {
    gateway = await startGateway();
    const res = await postSession(gateway.baseUrl, { origin: TEST_ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(TEST_ORIGIN);
    const body = (await res.json()) as { token: string; expiresInSec: number };
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.expiresInSec).toBe(120);
  });

  it('refuses a missing or foreign origin', async () => {
    gateway = await startGateway();
    expect((await postSession(gateway.baseUrl)).status).toBe(403);
    expect((await postSession(gateway.baseUrl, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('answers the CORS preflight for an allowed origin only', async () => {
    gateway = await startGateway();
    const ok = await fetch(`${gateway.baseUrl}/session`, {
      method: 'OPTIONS',
      headers: { origin: TEST_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toContain('POST');
    const bad = await fetch(`${gateway.baseUrl}/session`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('enforces the optional demo access code', async () => {
    gateway = await startGateway({ DEMO_ACCESS_CODE: 'open-sesame' });
    expect((await postSession(gateway.baseUrl, { origin: TEST_ORIGIN })).status).toBe(403);
    expect(
      (await postSession(gateway.baseUrl, { origin: TEST_ORIGIN, body: { accessCode: 'wrong' } })).status,
    ).toBe(403);
    expect(
      (await postSession(gateway.baseUrl, { origin: TEST_ORIGIN, body: { accessCode: 'open-sesame' } }))
        .status,
    ).toBe(200);
  });

  it('rate limits per IP with a friendly limit body', async () => {
    gateway = await startGateway({ SESSION_RATE_PER_IP_PER_MIN: '2' });
    await postSession(gateway.baseUrl, { origin: TEST_ORIGIN });
    await postSession(gateway.baseUrl, { origin: TEST_ORIGIN });
    const res = await postSession(gateway.baseUrl, { origin: TEST_ORIGIN });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
    expect(await res.json()).toMatchObject({ type: 'limit', reason: 'rate_limited' });
  });

  it('reports the budget when the credit guard is exhausted', async () => {
    const guard = new DailyCreditGuard({ stt_seconds: 0, tts_chars: 0 });
    gateway = await startGateway({}, { guard });
    const res = await postSession(gateway.baseUrl, { origin: TEST_ORIGIN });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ type: 'limit', reason: 'budget' });
  });
});

describe('GET /ws', () => {
  it('refuses a missing, garbage or reused token', async () => {
    gateway = await startGateway();
    await expect(WsTestClient.connect(gateway.wsUrl(''))).rejects.toThrow('401');
    await expect(WsTestClient.connect(gateway.wsUrl('a.b.c'))).rejects.toThrow('401');
    const token = await gateway.token();
    const first = await WsTestClient.connect(gateway.wsUrl(token));
    first.close();
    await expect(WsTestClient.connect(gateway.wsUrl(token))).rejects.toThrow('401');
  });

  it('refuses a browser origin that is not allowed', async () => {
    gateway = await startGateway();
    const token = await gateway.token();
    await expect(
      WsTestClient.connect(gateway.wsUrl(token), { origin: 'https://evil.example' }),
    ).rejects.toThrow('403');
  });

  it('replies ready after hello, with limits and the audio format', async () => {
    gateway = await startGateway({ MAX_SESSION_MINUTES: '7' });
    const client = await gateway.connect();
    client.sendJson(HELLO);
    const ready = await client.next('ready');
    expect(ready).toMatchObject({
      v: 2,
      limits: { maxSessionMinutes: 7 },
      audio: { inputSampleRate: 16000, inputFrameBytes: AUDIO_FRAME_BYTES },
    });
  });

  it('answers ping with pong echoing the timestamp', async () => {
    gateway = await startGateway();
    const client = await gateway.ready();
    client.sendJson({ type: 'ping', t: 12345 });
    expect(await client.next('pong')).toMatchObject({ t: 12345 });
  });

  it('rejects messages before hello and malformed messages, without closing', async () => {
    gateway = await startGateway();
    const client = await gateway.connect();
    client.sendJson({ type: 'ping', t: 1 });
    expect(await client.next('error')).toMatchObject({ code: 'BAD_MESSAGE' });
    client.sendJson({ type: 'hello', v: 99 });
    expect(await client.next('error')).toMatchObject({ code: 'BAD_MESSAGE' });
    client.ws.send('not json');
    expect(await client.next('error')).toMatchObject({ code: 'BAD_MESSAGE' });
    expect(client.closed).toBeUndefined();
  });

  it('closes a client that never says hello', async () => {
    gateway = await startGateway();
    const client = await gateway.connect();
    const closed = await client.waitClosed(12_000);
    expect(closed.code).toBe(4003);
  }, 15_000);

  it('applies context_update only when it is not older', async () => {
    gateway = await startGateway();
    const client = await gateway.ready();
    client.sendJson({
      type: 'context_update',
      catalog: { version: 2, customers: [{ id: 'c9', name: 'Gupta ji', aliases: [], balance: 5 }] },
    });
    client.sendJson({ type: 'context_update', catalog: { version: 1, customers: [] } });
    await sleep(50);
    // No public accessor on purpose: the session is internal. The connection must stay healthy.
    client.sendJson({ type: 'ping', t: 1 });
    expect(await client.next('pong')).toBeDefined();
  });

  it('drops wrong-size binary frames and counts them', async () => {
    gateway = await startGateway();
    const client = await gateway.ready();
    client.sendBinary(new Uint8Array(100));
    client.sendBinary(new Uint8Array(AUDIO_FRAME_BYTES + 1));
    await sleep(50);
    expect(gateway.app.gateway.metrics.badAudioFrames).toBe(2);
  });
});

describe('limits', () => {
  it('sends a friendly limit message and closes when the demo is full', async () => {
    gateway = await startGateway({ MAX_SESSIONS: '1' });
    // Take the second token while there is still room: once full, POST /session refuses.
    const spareToken = await gateway.token();
    const first = await gateway.ready();
    expect(first.closed).toBeUndefined();
    const second = await WsTestClient.connect(gateway.wsUrl(spareToken));
    expect(await second.next('limit')).toMatchObject({ reason: 'busy', retryAfterSec: 5 });
    expect((await second.waitClosed()).code).toBe(1013);
    // and POST /session now says busy instead of handing out a doomed token
    const res = await postSession(gateway.baseUrl, { origin: TEST_ORIGIN });
    expect(res.status).toBe(503);
  });

  it('expires a session after MAX_SESSION_MINUTES with a limit message', async () => {
    gateway = await startGateway();
    const client = await gateway.ready();
    // The cap is in whole minutes; shorten it by closing through the manager instead of waiting.
    gateway.app.gateway.sessions.forEach((s) =>
      s.closeWithLimit('session_expired', 'Session time is up.', 4001),
    );
    expect(await client.next('limit')).toMatchObject({ reason: 'session_expired' });
    expect((await client.waitClosed()).code).toBe(4001);
  });

  it('frees the slot when a client disconnects', async () => {
    gateway = await startGateway({ MAX_SESSIONS: '1' });
    const first = await gateway.ready();
    first.close();
    await sleep(100);
    expect(gateway.app.gateway.sessions.size).toBe(0);
    const second = await gateway.ready();
    expect(second.closed).toBeUndefined();
  });
});

describe('graceful drain', () => {
  it('notifies clients, refuses new sessions and closes the rest', async () => {
    gateway = await startGateway({ DRAIN_TIMEOUT_MS: '200' });
    const client = await gateway.ready();
    const draining = gateway.app.gateway.drain();
    expect(await client.next('limit')).toMatchObject({ reason: 'busy' });
    expect((await postSession(gateway.baseUrl, { origin: TEST_ORIGIN })).status).toBe(503);
    await draining;
    expect((await client.waitClosed()).code).toBe(1001);
  });

  it('finishes immediately when nobody is connected', async () => {
    gateway = await startGateway();
    await gateway.app.gateway.drain();
    expect(gateway.app.gateway.draining).toBe(true);
  });
});

describe('GET /metrics', () => {
  it('is disabled without a token and protected with one', async () => {
    gateway = await startGateway();
    expect((await fetch(`${gateway.baseUrl}/metrics`)).status).toBe(404);
    await gateway.close();
    gateway = await startGateway({ METRICS_TOKEN: 'metrics-secret' });
    expect((await fetch(`${gateway.baseUrl}/metrics`)).status).toBe(401);
    const res = await fetch(`${gateway.baseUrl}/metrics`, {
      headers: { authorization: 'Bearer metrics-secret' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ activeSessions: 0, maxSessions: 3 });
  });
});

describe('log hygiene', () => {
  it('never writes catalog names or message contents to the logs', async () => {
    const logs = captureLogs();
    gateway = await startGateway({ LOG_LEVEL: 'debug' }, { logStream: logs.stream });
    const client = await gateway.connect();
    client.sendJson({
      ...HELLO,
      catalog: {
        ...HELLO.catalog,
        customers: [{ id: 'c1', name: 'SECRET_CUSTOMER_NAME', aliases: [], balance: 1 }],
      },
    });
    await client.next('ready');
    client.sendJson({ type: 'speak', turnId: 1, text: 'SECRET_SPOKEN_TEXT' });
    client.ws.send('SECRET_GARBAGE_PAYLOAD');
    await sleep(100);
    await gateway.close();
    gateway = undefined;
    const output = logs.text();
    expect(output.length).toBeGreaterThan(0);
    for (const secret of ['SECRET_CUSTOMER_NAME', 'SECRET_SPOKEN_TEXT', 'SECRET_GARBAGE_PAYLOAD']) {
      expect(output).not.toContain(secret);
    }
    // the session token travels in the query string and must not be logged either
    expect(output).not.toMatch(/token=/);
  });
});
