import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { speechFrame, startMockGnani, type MockGnani } from '@bolbill/mock-gnani';
import { AUDIO_FRAME_BYTES } from '@bolbill/shared';
import { sleep } from './testing/client';
import { HELLO, startGateway, type Harness } from './testing/harness';

const DRAFT = {
  type: 'draft', turnId: 1, draftId: 'd1', intent: 'record_payment', source: 'rules', confidence: 0.9,
  customer: { id: 'c1', name: 'Sharma ji', isNew: false }, payment: { amount: 200 }, unresolved: [], warnings: [], replyText: ['ok'],
};
const TEMPLATES: unknown[] = [
  HELLO,
  { type: 'context_update', catalog: HELLO.catalog },
  { type: 'ptt_start', turnId: 1 },
  { type: 'ptt_start', turnId: 2, draftContext: DRAFT },
  { type: 'ptt_start', turnId: 3, draftContext: null },
  { type: 'ptt_end', turnId: 1 },
  { type: 'interrupt', turnId: 4_294_967_295 },
  { type: 'speak', turnId: 2, text: 'Bill save ho gaya.' },
  { type: 'ping', t: 1 },
];

/**
 * A hostile client: random bytes, broken JSON and valid messages with mutated fields, in a random
 * order. The gateway must never throw out of a handler, never hang, and keep serving others.
 * Seeded, so a failure replays exactly.
 */
let gateway: Harness | undefined;
let mock: MockGnani | undefined;
beforeEach(async () => {
  mock = await startMockGnani();
});
afterEach(async () => {
  await gateway?.close();
  gateway = undefined;
  await mock?.close();
  mock = undefined;
});

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const ODD_VALUES: unknown[] = [null, -1, 0, 1.5, 2 ** 32, 2 ** 53, Number.MAX_VALUE, '', 'x'.repeat(5000), [], {}, true, '\u0000', '<script>'];

function mutate(value: unknown, rand: () => number, depth = 0): unknown {
  if (rand() < 0.15 || depth > 4) return ODD_VALUES[Math.floor(rand() * ODD_VALUES.length)];
  if (Array.isArray(value)) return value.map((v) => mutate(v, rand, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (rand() > 0.1) out[k] = mutate(v, rand, depth + 1);
    if (rand() < 0.2) out['__proto__extra'] = 'unknown key';
    return out;
  }
  return value;
}

describe('fuzz: a hostile client', () => {
  it('random frames and messages never crash, hang or break the next session', async () => {
    gateway = await startGateway({ GNANI_STT_URL: mock!.stt.url, GNANI_TTS_URL: mock!.tts.url });
    for (let round = 0; round < 6; round++) {
      const rand = prng(1000 + round);
      const client = await gateway.ready();
      for (let i = 0; i < 120 && !client.closed; i++) {
        const pick = rand();
        if (pick < 0.3) {
          const length = rand() < 0.5 ? AUDIO_FRAME_BYTES : Math.floor(rand() * 3000);
          client.ws.send(Buffer.from(Array.from({ length }, () => Math.floor(rand() * 256))), { binary: true });
        } else if (pick < 0.4) {
          client.ws.send(Buffer.from(Array.from({ length: Math.floor(rand() * 200) }, () => Math.floor(rand() * 256))).toString('latin1'));
        } else if (pick < 0.5) {
          client.sendBinary(speechFrame());
        } else {
          const base = TEMPLATES[Math.floor(rand() * TEMPLATES.length)];
          client.sendJson(rand() < 0.5 ? base : mutate(base, rand));
        }
      }
      await sleep(50);
      client.close();
    }
    // Still healthy, and a fresh session runs a full turn.
    expect((await fetch(`${gateway.baseUrl}/healthz`)).status).toBe(200);
    const client = await gateway.ready();
    mock!.stt.queueTranscripts('Sharma ji ka kitna udhaar hai');
    client.sendJson({ type: 'ptt_start', turnId: 1 });
    for (let i = 0; i < 8; i++) client.sendBinary(speechFrame());
    client.sendJson({ type: 'ptt_end', turnId: 1 });
    expect(await client.next('draft')).toMatchObject({ intent: 'query_balance' });
  }, 30_000);
});
