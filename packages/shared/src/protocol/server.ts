import { z } from 'zod';
import { LIMITS, PROTOCOL_VERSION, TTS_PCM_FORMAT } from './constants';
import {
  idSchema,
  intentSchema,
  nameSchema,
  rupeesSchema,
  safeText,
  signedRupeesSchema,
  turnIdSchema,
  unitSchema,
} from './common';
import { TIMING_SPANS } from './timing';

/** Gateway → browser JSON messages. TTS audio is binary (see binary.ts). */

export const readySchema = z.object({
  type: z.literal('ready'),
  v: z.literal(PROTOCOL_VERSION),
  sessionId: idSchema,
  limits: z.object({
    maxSessionMinutes: z.number().int().positive(),
    maxUtteranceSeconds: z.number().int().positive(),
  }),
  audio: z.object({
    inputSampleRate: z.number().int().positive(),
    inputFrameBytes: z.number().int().positive(),
  }),
});

export const speechStartSchema = z.object({ type: z.literal('speech_start'), turnId: turnIdSchema });
export const processingSchema = z.object({ type: z.literal('processing'), turnId: turnIdSchema });

export const transcriptSchema = z.object({
  type: z.literal('transcript'),
  turnId: turnIdSchema,
  /** May be empty when nothing intelligible was said. */
  text: z.string().max(LIMITS.maxTranscriptLength),
  language: z.string().min(2).max(16).optional(),
  /** Gnani's reported transcription latency in ms. */
  sttMs: z.number().min(0).optional(),
});

export const billItemSchema = z.object({
  productId: idSchema,
  name: nameSchema,
  quantity: z.number().positive(),
  unit: unitSchema,
  unitPrice: rupeesSchema,
  lineTotal: rupeesSchema,
});
export type BillItem = z.infer<typeof billItemSchema>;

export const draftBillSchema = z.object({
  items: z.array(billItemSchema).max(LIMITS.maxBillItems),
  total: rupeesSchema,
  paid: rupeesSchema,
  udhaar: rupeesSchema,
});

export const draftCustomerSchema = z.object({
  /** Absent when the spoken name matched nobody (a new customer). */
  id: idSchema.optional(),
  name: nameSchema,
  isNew: z.boolean(),
});

export const draftPaymentSchema = z.object({ amount: rupeesSchema.min(1) });
export const draftBalanceSchema = z.object({ balance: signedRupeesSchema });

export const candidateSchema = z.object({
  id: idSchema,
  name: nameSchema,
  /** Match score between 0 and 1. */
  score: z.number().min(0).max(1),
});

export const unresolvedSchema = z.object({
  kind: z.enum(['item', 'customer']),
  /** What was said, length-limited. Displayed as text only. */
  spoken: z.string().min(1).max(LIMITS.maxNameLength),
  quantity: z.number().positive().optional(),
  unit: unitSchema.optional(),
  candidates: z.array(candidateSchema).max(LIMITS.maxCandidates),
});

export const draftSchema = z.object({
  type: z.literal('draft'),
  turnId: turnIdSchema,
  /** Idempotency key for saving this draft exactly once. */
  draftId: idSchema,
  intent: intentSchema,
  source: z.enum(['rules', 'llm']),
  confidence: z.number().min(0).max(1),
  customer: draftCustomerSchema.optional(),
  bill: draftBillSchema.optional(),
  payment: draftPaymentSchema.optional(),
  balance: draftBalanceSchema.optional(),
  unresolved: z.array(unresolvedSchema).max(LIMITS.maxUnresolved),
  warnings: z.array(safeText(LIMITS.maxWarningLength)).max(LIMITS.maxWarnings),
  /** At most two short sentences so TTS can start on the first. */
  replyText: z
    .array(safeText(LIMITS.maxReplySentenceLength))
    .min(1)
    .max(LIMITS.maxReplySentences),
});
export type DraftMessage = z.infer<typeof draftSchema>;

export const ttsStartSchema = z.object({
  type: z.literal('tts_start'),
  turnId: turnIdSchema,
  sampleRate: z.number().int().positive(),
  format: z.literal(TTS_PCM_FORMAT),
  /** True when the audio came from the phrase cache. */
  cached: z.boolean().optional(),
});

export const ttsEndSchema = z.object({
  type: z.literal('tts_end'),
  turnId: turnIdSchema,
  /** True when the stream ended because of an interrupt, not because it finished. */
  interrupted: z.boolean().optional(),
});

export const timingSchema = z.object({
  type: z.literal('timing'),
  turnId: turnIdSchema,
  spans: z.partialRecord(z.enum(TIMING_SPANS), z.number().min(0)),
  parseSource: z.enum(['rules', 'llm']).optional(),
});
export type TimingMessage = z.infer<typeof timingSchema>;

export const ERROR_CODES = [
  'BAD_MESSAGE',
  'RATE_LIMITED',
  'STT_UNAVAILABLE',
  'STT_ERROR',
  'NO_TRANSCRIPT',
  'UTTERANCE_TOO_LONG',
  'LLM_TIMEOUT',
  'TTS_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorSchema = z.object({
  type: z.literal('error'),
  turnId: turnIdSchema.optional(),
  code: z.enum(ERROR_CODES),
  message: safeText(LIMITS.maxMessageLength),
  retryable: z.boolean(),
});

export const LIMIT_REASONS = ['busy', 'budget', 'session_expired', 'rate_limited'] as const;

export const limitSchema = z.object({
  type: z.literal('limit'),
  reason: z.enum(LIMIT_REASONS),
  message: safeText(LIMITS.maxMessageLength),
  retryAfterSec: z.number().int().min(0).optional(),
  /** ISO timestamp when the daily budget resets, if known. */
  resetAt: z.string().max(40).optional(),
});

/** Reply to the client's `ping`, echoing its timestamp so the browser can measure RTT. */
export const pongSchema = z.object({ type: z.literal('pong'), t: z.number() });

export const serverMessageSchema = z.discriminatedUnion('type', [
  readySchema,
  speechStartSchema,
  processingSchema,
  transcriptSchema,
  draftSchema,
  ttsStartSchema,
  ttsEndSchema,
  timingSchema,
  errorSchema,
  limitSchema,
  pongSchema,
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerMessageType = ServerMessage['type'];
