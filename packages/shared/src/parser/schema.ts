import { z } from 'zod';
import { LIMITS } from '../protocol/constants';
import { intentSchema, nameSchema, unitSchema } from '../protocol/common';

/**
 * What a parser (rules or LLM) may output. There are NO prices here: pricing is
 * deterministic code in domain/pricing.ts. `unit` is null when none was spoken, so the
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

export type ParsedItemOutput = z.infer<typeof parsedItemSchema>;
export type ParsedUtterance = z.infer<typeof parsedUtteranceSchema>;
