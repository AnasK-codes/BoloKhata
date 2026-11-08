import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTtsFrame } from '@bolbill/shared';
import { RealtimeClient, type RealtimeConfig } from './client';
import { CATALOG, FakeWebSocket, READY, fakeFetch, jsonResponse, type FakeFetch } from './testing';
import type { ConnectionState, RealtimeIssue } from './types';
import type { ServerMessage } from '@bolbill/shared';

let net: FakeFetch;
let nowMs = 1000;

function make(config: Partial<RealtimeConfig> = {}) {
  const states: ConnectionState[] = [];
  const messages: ServerMessage[] = [];
  const issues: RealtimeIssue[] = [];
  const tts: { turnId: number; pcm: Uint8Array }[] = [];
  const client = new RealtimeClient(
    { gatewayUrl: 'http://gw.test:8080', getCatalog: () => CATALOG, ...config },
    {
      onState: (s) => states.push(s),
      onMessage: (m) => messages.push(m),
      onIssue: (i) => issues.push(i),
      onTtsAudio: (turnId, pcm) => tts.push({ turnId, pcm: pcm.slice() }),
    },
    {
      fetch: net.fetch,
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      now: () => nowMs,
      random: () => 1,
    },
  );
  return { client, states, messages, issues, tts };
}

/** Lets the fetch/getCatalog promises settle. */
const flush = () => vi.advanceTimersByTimeAsync(0);

async function connectReady(h = make()) {
  h.client.connect();
  await flush();
  FakeWebSocket.last.open();
  await flush();
  FakeWebSocket.last.receiveJson(READY);
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.reset();
  net = fakeFetch();
  net.respond(jsonResponse(200, { token: 'tok-1', expiresInSec: 120 }));
  nowMs = 1000;
});
afterEach(() => vi.useRealTimers());

describe('connecting', () => {
  it('uses the account session broker while keeping audio on the direct gateway socket', async () => {
    const { client } = make({ sessionUrl: '/api/account/gateway-session' });
    client.connect(); await flush();
    expect(net.calls[0]?.url).toBe('/api/account/gateway-session');
    expect(FakeWebSocket.last.url).toBe('ws://gw.test:8080/ws?token=tok-1');
    client.close();
  });
  it('gets a token, opens the socket with it, sends hello with the catalog, and becomes ready', async () => {
    const { client, states } = make();
    client.connect();
    await flush();

    expect(net.calls[0]?.url).toBe('http://gw.test:8080/session');
    expect(net.calls[0]?.init?.method).toBe('POST');
    expect(FakeWebSocket.last.url).toBe('ws://gw.test:8080/ws?token=tok-1');
    expect(FakeWebSocket.last.binaryType).toBe('arraybuffer');

    FakeWebSocket.last.open();
    await flush();
    expect(FakeWebSocket.last.sentJson[0]).toMatchObject({
      type: 'hello',
      v: 2,
      lang: 'hi-IN',
      catalog: CATALOG,
    });
    expect(client.isReady).toBe(false);

    FakeWebSocket.last.receiveJson(READY);
    expect(client.getState()).toMatchObject({ status: 'ready', sessionId: 's1', maxUtteranceSeconds: 20 });
    expect(states.map((s) => s.status)).toEqual(['connecting', 'ready']);
  });

  it('sends the current dialect setting in every hello, including after a reconnect', async () => {
    let dialect: 'bundeli' | 'malwi' = 'bundeli';
    const { client } = make({ getDialect: () => dialect });
    client.connect();
    await flush();
    FakeWebSocket.last.open();
    await flush();
    expect(FakeWebSocket.last.sentJson[0]).toMatchObject({ type: 'hello', dialect: 'bundeli' });
    dialect = 'malwi';
    client.close();
    client.connect();
    await flush();
    FakeWebSocket.last.open();
    await flush();
    expect(FakeWebSocket.last.sentJson[0]).toMatchObject({ type: 'hello', dialect: 'malwi' });
    client.close();
  });

  it('uses https as wss', async () => {
    const { client } = make({ gatewayUrl: 'https://gw.example' });
    client.connect();
    await flush();
    expect(FakeWebSocket.last.url).toBe('wss://gw.example/ws?token=tok-1');
  });

  it('sends the access code when one is configured', async () => {
    const { client } = make({ accessCode: () => 'sesame' });
    client.connect();
    await flush();
    expect(JSON.parse(net.calls[0]?.init?.body as string)).toEqual({ accessCode: 'sesame' });
  });

  it('is idempotent while connecting or ready', async () => {
    const h = make();
    h.client.connect();
    h.client.connect();
    await flush();
    expect(net.calls).toHaveLength(1);
    FakeWebSocket.last.open();
    await flush();
    FakeWebSocket.last.receiveJson(READY);
    h.client.connect();
    await flush();
    expect(net.calls).toHaveLength(1);
  });

  it('gives up on a socket that never answers hello and tries again', async () => {
    const h = make({ helloTimeoutMs: 5000 });
    h.client.connect();
    await flush();
    FakeWebSocket.last.open();
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.client.getState().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });
});

describe('sending', () => {
  it('passes the very same ArrayBuffer to the socket, with no copy and no JSON', async () => {
    const { client } = await connectReady();
    const frame = new ArrayBuffer(1024);
    expect(client.sendAudio(frame)).toBe(true);
    expect(FakeWebSocket.last.sentBinary[0]).toBe(frame);
    expect(client.stats.audioFramesSent).toBe(1);
  });

  it('drops frames, counts them and reports once per streak when the socket is not ready', async () => {
    const h = make();
    expect(h.client.sendAudio(new ArrayBuffer(1024))).toBe(false);
    expect(h.client.sendAudio(new ArrayBuffer(1024))).toBe(false);
    expect(h.client.stats.audioFramesDropped).toBe(2);
    expect(h.issues).toEqual([{ kind: 'audio_dropped', reason: 'not_ready' }]);

    await connectReady(h);
    expect(h.client.sendAudio(new ArrayBuffer(1024))).toBe(true);
    h.client.close();
    h.client.sendAudio(new ArrayBuffer(1024));
    expect(h.issues).toHaveLength(2); // a new streak is reported again
  });

  it('never queues audio when the socket is backed up', async () => {
    const h = await connectReady();
    FakeWebSocket.last.bufferedAmount = 200 * 1024;
    expect(h.client.sendAudio(new ArrayBuffer(1024))).toBe(false);
    expect(FakeWebSocket.last.sentBinary).toHaveLength(0);
    expect(h.issues).toEqual([{ kind: 'audio_dropped', reason: 'backpressure' }]);
  });

  it('sends JSON control messages only when ready', async () => {
    const h = make();
    expect(h.client.send({ type: 'ptt_start', turnId: 1 })).toBe(false);
    await connectReady(h);
    expect(h.client.send({ type: 'ptt_start', turnId: 1 })).toBe(true);
    expect(FakeWebSocket.last.sentJson.at(-1)).toEqual({ type: 'ptt_start', turnId: 1 });
  });
});

describe('receiving', () => {
  it('delivers validated messages and ignores unknown types without complaint', async () => {
    const h = await connectReady();
    FakeWebSocket.last.receiveJson({ type: 'transcript', turnId: 4, text: 'do kilo aata' });
    FakeWebSocket.last.receiveJson({ type: 'from_the_future', x: 1 });
    expect(h.messages.map((m) => m.type)).toEqual(['ready', 'transcript']);
    expect(h.issues).toEqual([]);
  });

  it('rejects known types with a bad shape and says so', async () => {
    const h = await connectReady();
    FakeWebSocket.last.receiveJson({ type: 'transcript', turnId: 'four', text: 1 });
    FakeWebSocket.last.receive('not json');
    expect(h.messages.map((m) => m.type)).toEqual(['ready']);
    expect(h.issues).toEqual([{ kind: 'bad_message', messageType: 'transcript' }, { kind: 'bad_message' }]);
    expect(h.client.stats.badMessages).toBe(2);
  });

  it('decodes TTS frames into a turn id and PCM', async () => {
    const h = await connectReady();
    const pcm = Uint8Array.from([1, 0, 2, 0, 3, 0]);
    const frame = encodeTtsFrame(77, pcm);
    FakeWebSocket.last.receive(frame.buffer);
    expect(h.tts).toEqual([{ turnId: 77, pcm }]);
    FakeWebSocket.last.receive(new ArrayBuffer(3));
    expect(h.issues).toEqual([{ kind: 'bad_binary' }]);
  });

  it('ignores events from a socket it already dropped', async () => {
    const h = await connectReady();
    const old = FakeWebSocket.last;
    h.client.close();
    old.onmessage?.({ data: JSON.stringify({ type: 'transcript', turnId: 1, text: 'x' }) });
    expect(h.messages.map((m) => m.type)).toEqual(['ready']);
  });
});

describe('heartbeat', () => {
  it('measures the round trip from ping and pong', async () => {
    const h = await connectReady();
    const ping = FakeWebSocket.last.sentJson.find((m) => m['type'] === 'ping');
    expect(ping).toEqual({ type: 'ping', t: 1000 });
    nowMs = 1042;
    FakeWebSocket.last.receiveJson({ type: 'pong', t: 1000 });
    expect(h.client.getState()).toMatchObject({ status: 'ready', rttMs: 42 });
    expect(h.messages.some((m) => m.type === 'pong')).toBe(false);
  });

  it('pings again every interval while the gateway answers', async () => {
    await connectReady(make({ heartbeatMs: 1000 }));
    for (let i = 0; i < 3; i++) {
      nowMs += 1000;
      await vi.advanceTimersByTimeAsync(1000);
      FakeWebSocket.last.receiveJson({ type: 'pong', t: nowMs });
    }
    expect(FakeWebSocket.last.sentJson.filter((m) => m['type'] === 'ping')).toHaveLength(4);
  });

  it('reconnects when pongs stop (half-open connection)', async () => {
    const h = await connectReady(make({ heartbeatMs: 1000 }));
    for (let i = 0; i < 4; i++) {
      nowMs += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(FakeWebSocket.instances[0]?.closedWith).toBe(4000);
    expect(h.client.stats.reconnects).toBe(1);
    expect(net.calls.length).toBeGreaterThan(1); // and it has already started a new session
  });
});

describe('reconnecting', () => {
  it('retries with growing delays, sends hello again, and resets after ready', async () => {
    const h = await connectReady();
    FakeWebSocket.last.drop();
    expect(h.client.getState()).toMatchObject({ status: 'reconnecting', attempt: 0, delayMs: 500 });

    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.last.drop(); // fails before ready
    expect(h.client.getState()).toMatchObject({ status: 'reconnecting', attempt: 1, delayMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    FakeWebSocket.last.open();
    await flush();
    expect(FakeWebSocket.last.sentJson[0]).toMatchObject({ type: 'hello' });
    FakeWebSocket.last.receiveJson(READY);

    FakeWebSocket.last.drop();
    expect(h.client.getState()).toMatchObject({ status: 'reconnecting', attempt: 0, delayMs: 500 });
  });

  it('re-reads the catalog on every reconnect so prices and balances are current', async () => {
    let version = 1;
    const h = make({ getCatalog: () => ({ ...CATALOG, version: version++ }) });
    await connectReady(h);
    FakeWebSocket.last.drop();
    await vi.advanceTimersByTimeAsync(500);
    FakeWebSocket.last.open();
    await flush();
    expect((FakeWebSocket.last.sentJson[0]?.['catalog'] as { version: number }).version).toBe(2);
  });

  it('retries when the token request fails', async () => {
    net.respond(jsonResponse(500, {}), jsonResponse(200, { token: 'tok-2' }));
    const h = make();
    h.client.connect();
    await flush();
    expect(h.client.getState().status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(600);
    expect(FakeWebSocket.last.url).toContain('tok-2');
  });

  it('starts a fresh session at once when the session expires', async () => {
    const h = await connectReady();
    FakeWebSocket.last.drop(4001);
    await flush();
    expect(h.client.getState().status).toBe('connecting');
    expect(net.calls).toHaveLength(2);
  });

  it('does not reconnect after close()', async () => {
    const h = await connectReady();
    h.client.close();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(h.client.getState().status).toBe('closed');
  });
});

describe('close codes and failed handshakes', () => {
  it.each([[1001, 'the server is going away'], [1008, 'the server closed us for a policy reason'], [1013, 'try again later'], [1006, 'the connection dropped']])(
    'on close %i (%s) it backs off and then reconnects with a fresh hello',
    async (code) => {
      const h = await connectReady();
      FakeWebSocket.last.drop(code);
      expect(h.client.getState()).toMatchObject({ status: 'reconnecting' });
      await vi.advanceTimersByTimeAsync(700);
      FakeWebSocket.last.open();
      await flush();
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(FakeWebSocket.last.sentJson[0]).toMatchObject({ type: 'hello' });
    },
  );

  it('a socket that closes before it ever opens (a refused upgrade) is retried with a new token, not in a tight loop', async () => {
    net.respond(jsonResponse(200, { token: 'a' }), jsonResponse(200, { token: 'b' }));
    const h = make();
    h.client.connect();
    await flush();
    FakeWebSocket.last.drop(1006);
    await vi.advanceTimersByTimeAsync(100);
    expect(net.calls).toHaveLength(1); // still waiting out the backoff
    await vi.advanceTimersByTimeAsync(600);
    expect(net.calls).toHaveLength(2);
    expect(FakeWebSocket.last.url).toContain('b');
  });
});

describe('limits', () => {
  it('shows a friendly busy state with a retry time, then retries on its own', async () => {
    net.respond(
      jsonResponse(503, { type: 'limit', reason: 'busy', message: 'Busy.', retryAfterSec: 7 }),
      jsonResponse(200, { token: 'tok-3' }),
    );
    const h = make();
    h.client.connect();
    await flush();
    expect(h.client.getState()).toMatchObject({ status: 'limited', reason: 'busy', message: 'Busy.' });
    const state = h.client.getState();
    if (state.status !== 'limited') throw new Error('expected limited');
    expect(state.retryAt - Date.now()).toBeGreaterThan(6000);

    await vi.advanceTimersByTimeAsync(7000);
    expect(FakeWebSocket.last.url).toContain('tok-3');
  });

  it('treats a rate limit the same way', async () => {
    net.respond(jsonResponse(429, { type: 'limit', reason: 'rate_limited', message: 'Slow down.', retryAfterSec: 3 }));
    const h = make();
    h.client.connect();
    await flush();
    expect(h.client.getState()).toMatchObject({ status: 'limited', reason: 'rate_limited' });
  });

  it('honours a limit message mid-session and does not hammer the gateway on the close that follows', async () => {
    const h = await connectReady();
    FakeWebSocket.last.receiveJson({ type: 'limit', reason: 'busy', message: 'Restarting.', retryAfterSec: 5 });
    expect(h.client.getState()).toMatchObject({ status: 'limited', reason: 'busy' });
    FakeWebSocket.last.drop(1013);
    await vi.advanceTimersByTimeAsync(4000);
    expect(net.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(net.calls).toHaveLength(2);
  });

  it('reports the daily budget with its reset time and waits longer', async () => {
    net.respond(jsonResponse(503, { type: 'limit', reason: 'budget', message: 'Used up.', resetAt: '2026-11-05T00:00:00Z' }));
    const h = make();
    h.client.connect();
    await flush();
    expect(h.client.getState()).toMatchObject({ status: 'limited', reason: 'budget', resetAt: '2026-11-05T00:00:00Z' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.calls).toHaveLength(1);
  });

  it('stops and asks for a person when the access code is wrong', async () => {
    net.respond(jsonResponse(403, { error: 'access_code_required' }));
    const h = make();
    h.client.connect();
    await flush();
    expect(h.client.getState()).toMatchObject({ status: 'blocked', reason: 'access_code_required' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.calls).toHaveLength(1);
  });
});

describe('a wrong or missing access code', () => {
  it('can be retried with a new code: connect() works again from the blocked state', async () => {
    const typed: { code?: string } = {};
    net.respond(jsonResponse(403, { error: 'access_code_required' }));
    const h = make({ accessCode: () => typed.code });
    h.client.connect();
    await flush();
    expect(h.client.getState()).toMatchObject({ status: 'blocked' });

    typed.code = 'sesame';
    net.respond(jsonResponse(200, { token: 'tok-ok' }));
    h.client.connect();
    await flush();
    expect(JSON.parse(net.calls.at(-1)?.init?.body as string)).toEqual({ accessCode: 'sesame' });
    expect(FakeWebSocket.last.url).toContain('tok-ok');
  });
});

describe('page lifecycle', () => {
  function pageHarness() {
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
    const win = new EventTarget();
    return { doc, win };
  }

  it('reconnects at once when the page returns and the connection is down', async () => {
    const h = await connectReady();
    const { doc, win } = pageHarness();
    h.client.attachPageLifecycle(doc as unknown as Document, win as unknown as Window);
    FakeWebSocket.last.drop();
    expect(h.client.getState().status).toBe('reconnecting');
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(h.client.getState().status).toBe('connecting');
    expect(net.calls).toHaveLength(2);
  });

  it('checks a seemingly healthy connection when the page returns, and recycles it if silent', async () => {
    const h = await connectReady();
    const { doc, win } = pageHarness();
    h.client.attachPageLifecycle(doc as unknown as Document, win as unknown as Window);
    const pingsBefore = FakeWebSocket.last.sentJson.filter((m) => m['type'] === 'ping').length;
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.last.sentJson.filter((m) => m['type'] === 'ping')).toHaveLength(pingsBefore + 1);
    await vi.advanceTimersByTimeAsync(2600);
    expect(h.client.getState().status).toBe('reconnecting');
  });

  it('does nothing when the page is hidden, and stops listening after dispose', async () => {
    const h = await connectReady();
    const { doc, win } = pageHarness();
    const dispose = h.client.attachPageLifecycle(doc as unknown as Document, win as unknown as Window);
    FakeWebSocket.last.drop();
    (doc as { visibilityState: string }).visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.client.getState().status).toBe('reconnecting');
    dispose();
    (doc as { visibilityState: string }).visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(net.calls).toHaveLength(1);
  });

  it('also wakes up when the network comes back', async () => {
    const h = await connectReady();
    const { doc, win } = pageHarness();
    h.client.attachPageLifecycle(doc as unknown as Document, win as unknown as Window);
    FakeWebSocket.last.drop();
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(h.client.getState().status).toBe('connecting');
  });
});
