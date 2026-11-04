import type { ClientMessage } from './client';
import type { ServerMessage } from './server';

/**
 * One valid example per message type, plus one deliberately malformed variant.
 * All names and amounts are fictional.
 */

export const CLIENT_FIXTURES: Record<ClientMessage['type'], { valid: unknown; invalid: unknown }> = {
  hello: {
    valid: {
      type: 'hello',
      v: 2,
      clientTime: 1_700_000_000_000,
      lang: 'hi-en',
      catalog: {
        version: 3,
        products: [
          {
            id: 'p-aata',
            name: 'Aata',
            aliases: ['atta', 'gehu ka aata'],
            unit: 'kg',
            pricePerUnit: 45,
            category: 'staples',
          },
          { id: 'p-maggi', name: 'Maggi', aliases: ['maggi noodles'], unit: 'packet', pricePerUnit: 14 },
        ],
        customers: [{ id: 'c-sharma', name: 'Sharma ji', aliases: ['sharma uncle'], balance: 320 }],
      },
    },
    invalid: {
      type: 'hello',
      v: 2,
      clientTime: 1,
      lang: 'hi-en',
      catalog: {
        version: 1,
        products: [{ id: 'p1', name: 'Aata', aliases: [], unit: 'kg', pricePerUnit: 45.5 }],
        customers: [],
      },
    },
  },
  context_update: {
    valid: {
      type: 'context_update',
      catalog: {
        version: 4,
        customers: [{ id: 'c-sharma', name: 'Sharma ji', aliases: [], balance: -50 }],
      },
    },
    invalid: { type: 'context_update', catalog: { version: -1 } },
  },
  ptt_start: { valid: { type: 'ptt_start', turnId: 1 }, invalid: { type: 'ptt_start', turnId: -1 } },
  ptt_end: { valid: { type: 'ptt_end', turnId: 1 }, invalid: { type: 'ptt_end' } },
  interrupt: {
    valid: { type: 'interrupt', turnId: 4_294_967_295 },
    invalid: { type: 'interrupt', turnId: 4_294_967_296 },
  },
  speak: {
    valid: { type: 'speak', turnId: 2, text: 'Bill save ho gaya.' },
    invalid: { type: 'speak', turnId: 2, text: '' },
  },
  ping: { valid: { type: 'ping', t: 12.5 }, invalid: { type: 'ping', t: 'now' } },
};

const draftBase = {
  type: 'draft',
  turnId: 7,
  draftId: 'd-0001',
  source: 'rules',
  confidence: 0.92,
  unresolved: [],
  warnings: [],
} as const;

export const SERVER_FIXTURES: Record<ServerMessage['type'], { valid: unknown; invalid: unknown }> = {
  ready: {
    valid: {
      type: 'ready',
      v: 2,
      sessionId: 's-abc123',
      limits: { maxSessionMinutes: 10, maxUtteranceSeconds: 20 },
      audio: { inputSampleRate: 16000, inputFrameBytes: 1024 },
    },
    invalid: { type: 'ready', v: 2, sessionId: 's-abc123' },
  },
  speech_start: {
    valid: { type: 'speech_start', turnId: 7 },
    invalid: { type: 'speech_start', turnId: 'seven' },
  },
  processing: { valid: { type: 'processing', turnId: 7 }, invalid: { type: 'processing' } },
  transcript: {
    valid: { type: 'transcript', turnId: 7, text: 'do kilo aata aur ek Maggi', language: 'hi-IN', sttMs: 320 },
    invalid: { type: 'transcript', turnId: 7, text: 42 },
  },
  draft: {
    valid: {
      ...draftBase,
      intent: 'create_bill',
      customer: { id: 'c-sharma', name: 'Sharma ji', isNew: false },
      bill: {
        items: [
          { productId: 'p-aata', name: 'Aata', quantity: 2, unit: 'kg', unitPrice: 45, lineTotal: 90 },
          { productId: 'p-maggi', name: 'Maggi', quantity: 1, unit: 'packet', unitPrice: 14, lineTotal: 14 },
        ],
        total: 104,
        paid: 0,
        udhaar: 104,
      },
      unresolved: [
        {
          kind: 'item',
          spoken: 'chini',
          quantity: 0.5,
          unit: 'kg',
          candidates: [{ id: 'p-cheeni', name: 'Cheeni', score: 0.81 }],
        },
      ],
      warnings: ['Cheeni confirm kar lijiye.'],
      replyText: ['Sharma ji ka bill ek sau chaar rupaye.', 'Poora udhaar likh doon?'],
    },
    invalid: {
      ...draftBase,
      intent: 'create_bill',
      bill: { items: [], total: 10.5, paid: 0, udhaar: 0 },
      replyText: ['ok'],
    },
  },
  tts_start: {
    valid: { type: 'tts_start', turnId: 7, sampleRate: 24000, format: 'pcm_s16le', cached: false },
    invalid: { type: 'tts_start', turnId: 7, sampleRate: 24000, format: 'mp3' },
  },
  tts_end: {
    valid: { type: 'tts_end', turnId: 7, interrupted: true },
    invalid: { type: 'tts_end', turnId: 7, interrupted: 'yes' },
  },
  timing: {
    valid: {
      type: 'timing',
      turnId: 7,
      spans: { commit_sent: 0, transcript: 342, draft: 351, tts_first_chunk: 640 },
      parseSource: 'rules',
    },
    invalid: { type: 'timing', turnId: 7, spans: { not_a_span: 1 } },
  },
  error: {
    valid: {
      type: 'error',
      turnId: 7,
      code: 'STT_UNAVAILABLE',
      message: 'Speech service is not reachable. Please try again.',
      retryable: true,
    },
    invalid: { type: 'error', code: 'WHATEVER', message: 'x', retryable: true },
  },
  limit: {
    valid: {
      type: 'limit',
      reason: 'busy',
      message: 'Demo abhi busy hai. Thodi der baad try karein.',
      retryAfterSec: 30,
    },
    invalid: { type: 'limit', reason: 'busy' },
  },
  pong: { valid: { type: 'pong', t: 12.5 }, invalid: { type: 'pong' } },
};
