import { z } from 'zod';
import { LIMITS, MAX_TURN_ID } from './constants';

/** Unsigned 32-bit turn ID. */
export const turnIdSchema = z.number().int().min(0).max(MAX_TURN_ID);

/** Whole rupees. Money is never a float. */
export const rupeesSchema = z.number().int().min(0);
/** A balance can be negative when a customer overpaid (the shop owes them). */
export const signedRupeesSchema = z.number().int();

export const UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'packet', 'dozen'] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof unitSchema>;

export const INTENTS = [
  'create_bill',
  'record_payment',
  'query_balance',
  'query_summary',
  'out_of_stock',
  'add_customer',
  'add_product',
  'add_products',
  'update_price',
  'confirm',
  'cancel',
  'unknown',
] as const;
export const intentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof intentSchema>;

/**
 * The shopkeeper's way of speaking, set in the app. Gnani has no dialect models (only Hindi and
 * nine other languages), so this only selects which regional word lists the rule parser folds in.
 */
export const DIALECTS = ['auto', 'hinglish', 'malwi', 'nimadi', 'bundeli', 'bagheli'] as const;
export const dialectSchema = z.enum(DIALECTS);
export type Dialect = z.infer<typeof dialectSchema>;

export const idSchema = z.string().min(1).max(LIMITS.maxIdLength);
export const nameSchema = z.string().min(1).max(LIMITS.maxNameLength);
export const aliasesSchema = z.array(nameSchema).max(LIMITS.maxAliasesPerEntry);

/** A spoken or displayed sentence. Control characters are rejected at the boundary. */
// eslint-disable-next-line no-control-regex -- the point is to detect control characters
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
export function safeText(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((s) => !CONTROL_CHARS.test(s), { message: 'control characters are not allowed' });
}
