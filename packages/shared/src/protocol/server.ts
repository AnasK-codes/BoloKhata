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
import { billAdjustSchema } from '../domain/adjustments';

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

export const spokenPriceSchema = z.object({
  amount: rupeesSchema.max(1_000_000_000),
  basis: z.enum(['line', 'unit']),
  quantity: z.number().positive().max(1_000_000),
  unit: unitSchema,
});
export type SpokenPrice = z.infer<typeof spokenPriceSchema>;

export const billItemSchema = z.object({
  productId: idSchema,
  name: nameSchema,
  quantity: z.number().positive(),
  unit: unitSchema,
  /** Null when an exact whole-rupee rate cannot be derived from a spoken line total. */
  unitPrice: rupeesSchema.nullable(),
  lineTotal: rupeesSchema,
  spokenPrice: spokenPriceSchema.optional(),
}).refine((item) => item.unitPrice !== null || item.spokenPrice !== undefined, 'A line without an exact unit rate requires its spoken-price quote.');
export type BillItem = z.infer<typeof billItemSchema>;

export const draftBillSchema = z.object({
  items: z.array(billItemSchema).max(LIMITS.maxBillItems),
  total: rupeesSchema,
  paid: rupeesSchema,
  udhaar: rupeesSchema,
  /** Discount, GST and round-off behind `total` (the payable amount). Absent when none applies. */
  adjust: billAdjustSchema.optional(),
});

export const draftCustomerSchema = z.object({
  /** Absent when the spoken name matched nobody (a new customer). */
  id: idSchema.optional(),
  name: nameSchema,
  isNew: z.boolean(),
  creditReady: z.boolean().optional(),
});

export const draftPaymentSchema = z.object({ amount: rupeesSchema.min(1) });
export const draftBalanceSchema = z.object({ balance: signedRupeesSchema });
export const draftSummarySchema = z.object({ todaySales: rupeesSchema, todayBills: z.number().int().min(0), totalUdhaar: rupeesSchema });
/** "Aata khatam ho gaya": the product to mark as out of stock once the user confirms. */
export const draftStockSchema = z.object({ productId: idSchema, name: nameSchema });
/** "Samaan mein chawal 40 rupaye kilo": a product to create once the user confirms. `id` means it already exists. */
export const draftProductSchema = z.object({
  id: idSchema.optional(),
  name: nameSchema,
  unit: unitSchema,
  pricePerUnit: rupeesSchema.min(1),
  /** update_price only: the rate before the change, for the card. */
  previousPrice: rupeesSchema.optional(),
  isNew: z.boolean(),
});

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
  summary: draftSummarySchema.optional(),
  stock: draftStockSchema.optional(),
  product: draftProductSchema.optional(),
  /** add_products: a whole list of products to create after one confirmation. */
  products: z.array(draftProductSchema).max(LIMITS.maxBillItems).optional(),
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
