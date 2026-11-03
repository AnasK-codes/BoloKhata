import type { ZodType } from 'zod';
import { clientMessageSchema, type ClientMessage } from './client';
import { MAX_ANY_MESSAGE_BYTES, MAX_MESSAGE_BYTES } from './constants';
import { serverMessageSchema, type ServerMessage } from './server';

/**
 * Why a message was rejected. Deliberately coarse: error values must never contain the
 * offending text (it may be a transcript or a customer name).
 */
export type ParseFailureReason = 'too_large' | 'invalid_json' | 'unknown_type' | 'invalid_shape';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ParseFailureReason; messageType?: string };

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  // UTF-16 length <= UTF-8 length <= 3x UTF-16 length. Only encode when the answer is unclear.
  return encoder.encode(text).byteLength;
}

function exceeds(raw: string, limit: number): boolean {
  if (raw.length > limit) return true;
  if (raw.length * 3 <= limit) return false;
  return utf8Length(raw) > limit;
}

function parseMessage<T>(
  raw: unknown,
  schema: ZodType<T>,
  limits: Readonly<Record<string, number>>,
): ParseResult<T> {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid_json' };
  if (exceeds(raw, MAX_ANY_MESSAGE_BYTES)) return { ok: false, reason: 'too_large' };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, reason: 'invalid_json' };
  }

  const type = (json as { type?: unknown }).type;
  if (typeof type !== 'string' || !Object.hasOwn(limits, type)) {
    return { ok: false, reason: 'unknown_type' };
  }
  // `type` is one of our own literals from here on, so it is safe to report.
  const limit = limits[type] as number;
  if (exceeds(raw, limit)) return { ok: false, reason: 'too_large', messageType: type };

  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, reason: 'invalid_shape', messageType: type };
  return { ok: true, value: result.data };
}

const CLIENT_TYPES = ['hello', 'context_update', 'ptt_start', 'ptt_end', 'interrupt', 'speak', 'ping'] as const;
const SERVER_TYPES = [
  'ready',
  'speech_start',
  'processing',
  'transcript',
  'draft',
  'tts_start',
  'tts_end',
  'timing',
  'error',
  'limit',
  'pong',
] as const;

function limitsFor(types: readonly (keyof typeof MAX_MESSAGE_BYTES)[]): Record<string, number> {
  return Object.fromEntries(types.map((t) => [t, MAX_MESSAGE_BYTES[t]]));
}

const CLIENT_LIMITS = limitsFor(CLIENT_TYPES);
const SERVER_LIMITS = limitsFor(SERVER_TYPES);

/** Validates one browser → gateway JSON message. Never throws. */
export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  return parseMessage(raw, clientMessageSchema, CLIENT_LIMITS);
}

/** Validates one gateway → browser JSON message. Never throws. */
export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  return parseMessage(raw, serverMessageSchema, SERVER_LIMITS);
}
