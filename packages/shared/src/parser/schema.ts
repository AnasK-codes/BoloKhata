import { z } from 'zod';
import { LIMITS } from '../protocol/constants';
import { intentSchema, nameSchema, unitSchema } from '../protocol/common';
import type { ParsedItem } from '../domain/pricing';
import type { BillAdjust } from '../domain/adjustments';

/**
 * What an LLM may output. There are NO prices in its schema. Rules can attach a
 * literal spoken quote in the internal types; pricing remains deterministic. `unit` is null when none was spoken, so the
 * catalog unit is used instead of a guess.
 */
export const parsedItemSchema = z.object({
  name: nameSchema,
  quantity: z.number().positive().max(1_000_000),
  unit: unitSchema.nullable(),
});

export const parsedUtteranceSchema = z.object({
  intent: intentSchema,
  customer: nameSchema.nullable(),
  items: z.array(parsedItemSchema).max(LIMITS.maxBillItems),
  amount_paid: z.number().int().min(0).nullable(),
  udhaar_amount: z.number().int().min(0).nullable(),
  confidence: z.number().min(0).max(1),
});

export type ParsedItemOutput = z.infer<typeof parsedItemSchema> & Pick<ParsedItem, 'spokenPrice'>;
export type ParsedUtterance = Omit<z.infer<typeof parsedUtteranceSchema>, 'items'> & {
  items: ParsedItemOutput[];
  /** Rules only (discount, GST, round-off). Not in the LLM schema, so a model's answer cannot carry it. */
  adjust?: BillAdjust;
  /** Rules only: things the speaker asked for that could not be applied (for example GST without a rate). */
  adjustWarnings?: string[];
};
