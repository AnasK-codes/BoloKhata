import { z } from 'zod';
import { LIMITS, PROTOCOL_VERSION } from './constants';
import { draftSchema } from './server';
import {
  aliasesSchema,
  idSchema,
  nameSchema,
  rupeesSchema,
  safeText,
  signedRupeesSchema,
  turnIdSchema,
  unitSchema,
} from './common';

/** Browser → gateway JSON messages. Audio frames are binary and have no JSON envelope. */

export const catalogProductSchema = z.object({
  id: idSchema,
  name: nameSchema,
  aliases: aliasesSchema,
  unit: unitSchema,
  pricePerUnit: rupeesSchema,
  category: nameSchema.optional(),
  /** Optional on-hand count in `unit`s. Kept on the device; the snapshot sent to the gateway leaves it out. */
  stock: z.number().min(0).max(1_000_000).optional(),
});
export type CatalogProduct = z.infer<typeof catalogProductSchema>;

export const catalogCustomerSchema = z.object({
  id: idSchema,
  name: nameSchema,
  aliases: aliasesSchema,
  /** Derived on the device from ledger entries; sent so the gateway can answer "kitna udhaar hai". */
  balance: signedRupeesSchema,
  creditReady: z.boolean().optional(),
});
export type CatalogCustomer = z.infer<typeof catalogCustomerSchema>;

/** Shop-wide numbers for "aaj kitni bikri hui". Derived on the device from bills and the ledger. */
export const shopStatsSchema = z.object({
  todaySales: rupeesSchema,
  todayBills: z.number().int().min(0),
  totalUdhaar: rupeesSchema,
});
export type ShopStats = z.infer<typeof shopStatsSchema>;

const productsSchema = z.array(catalogProductSchema).max(LIMITS.maxProducts);
const customersSchema = z.array(catalogCustomerSchema).max(LIMITS.maxCustomers);

export const helloSchema = z.object({
  type: z.literal('hello'),
  v: z.literal(PROTOCOL_VERSION),
  clientTime: z.number(),
  lang: z.string().min(2).max(16),
  catalog: z.object({
    version: z.number().int().min(0),
    products: productsSchema,
    customers: customersSchema,
    shop: shopStatsSchema.optional(),
  }),
});

export const contextUpdateSchema = z.object({
  type: z.literal('context_update'),
  catalog: z.object({
    version: z.number().int().min(0),
    products: productsSchema.optional(),
    customers: customersSchema.optional(),
    shop: shopStatsSchema.optional(),
  }),
});

export const pttStartSchema = z.object({
  type: z.literal('ptt_start'), turnId: turnIdSchema,
  /** Current unsaved draft, including local edits. Null clears obsolete gateway state. */
  draftContext: draftSchema.nullable().optional(),
});
export const pttEndSchema = z.object({ type: z.literal('ptt_end'), turnId: turnIdSchema });
export const interruptSchema = z.object({ type: z.literal('interrupt'), turnId: turnIdSchema });

export const speakSchema = z.object({
  type: z.literal('speak'),
  turnId: turnIdSchema,
  text: safeText(LIMITS.maxSpeakTextLength),
});

export const pingSchema = z.object({ type: z.literal('ping'), t: z.number() });

export const clientMessageSchema = z.discriminatedUnion('type', [
  helloSchema,
  contextUpdateSchema,
  pttStartSchema,
  pttEndSchema,
  interruptSchema,
  speakSchema,
  pingSchema,
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageType = ClientMessage['type'];
export type HelloMessage = z.infer<typeof helloSchema>;
