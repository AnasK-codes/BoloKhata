import { z } from 'zod';
import { LIMITS, UNITS, billAdjustSchema, spokenNumbers, type ParsedItemOutput, type ParsedUtterance } from '@bolbill/shared';
import type { ToolCall, ToolSpec } from '../llm/types';

/**
 * The tools of PARSER_MODE=ai_only. The model picks one and fills its arguments; code turns the call
 * into the same ParsedUtterance the rule parser makes, and everything after that (matching names to the
 * catalog, pricing, totals, balances) is the ordinary deterministic code. A tool call is only a
 * reading of the sentence: it never contains a price, total or balance of its own.
 *
 * Every rupee amount the model reports (paid, udhaar, a quoted price, a rate, a discount) must be a
 * number the speaker actually said (`spokenNumbers`); otherwise the call is rejected and the turn
 * falls back to the rules. Confirm and cancel are deliberately not tools.
 */

const text = (description: string) => ({ type: 'string', description });
const int = (description: string) => ({ type: 'integer', description });
const unitProp = { type: 'string', enum: [...UNITS], description: 'Unit that was spoken. Leave out if none was spoken.' };
const REPLY = text(
  'What to say back: at most 2 short Hinglish sentences in Roman letters. Never write digits. To mention a computed number or name, use only these placeholders, which the system fills in: {customer} {total} {paid} {udhaar} {balance} {amount} {product} {rate} {sales} {bills}. Never say that anything was saved or done.',
);

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: { ...properties, reply: REPLY }, required });
const itemJson = {
  type: 'object',
  properties: {
    name: text('Item name as spoken, preferring the spelling from the known items.'),
    quantity: { type: 'number', description: 'Quantity. aadha=0.5, dedh=1.5, dhai=2.5, sawa X=X+0.25, saade X=X+0.5.' },
    unit: unitProp,
    quoted_price: {
      type: 'object',
      description: 'Only if the shopkeeper SPOKE a price for this item ("do kilo chawal 110 ke").',
      properties: { amount: int('The rupee amount that was spoken.'), per: { type: 'string', enum: ['line', 'unit'], description: 'line = for the whole quantity, unit = per kg/piece/etc.' } },
      required: ['amount', 'per'],
    },
  },
  required: ['name', 'quantity'],
};
const productJson = { type: 'object', properties: { name: text('Product name as spoken.'), unit: unitProp, rate: int('The spoken rate in rupees per unit.') }, required: ['name', 'rate'] };

const name = z.string().trim().min(1).max(LIMITS.maxNameLength);
const unit = z.enum(UNITS).nullish();
const reply = z.string().max(400).nullish();
const rupees = z.number().int().min(0).max(100_000_000);
const rate = z.number().int().min(1).max(10_000_000);
const item = z.object({
  name,
  quantity: z.number().positive().max(1_000_000),
  unit,
  quoted_price: z.object({ amount: rate, per: z.enum(['line', 'unit']) }).nullish(),
});
const product = z.object({ name, unit, rate });

const ARGS = {
  create_bill: z.object({
    customer: name.nullish(),
    items: z.array(item).min(1).max(LIMITS.maxBillItems),
    amount_paid: rupees.nullish(),
    udhaar_amount: rupees.nullish(),
    discount_amount: rupees.nullish(),
    discount_percent: z.number().int().min(1).max(100).nullish(),
    gst_percent: z.number().int().min(1).max(28).nullish(),
    round_off: z.boolean().nullish(),
    reply,
  }),
  record_payment: z.object({ customer: name, amount: rate, reply }),
  query_balance: z.object({ customer: name, reply }),
  query_summary: z.object({ reply }),
  out_of_stock: z.object({ product: name, reply }),
  add_customer: z.object({ name, reply }),
  add_product: z.object({ name, unit, rate, reply }),
  add_products: z.object({ products: z.array(product).min(1).max(LIMITS.maxBillItems), reply }),
  update_price: z.object({ product: name, unit, rate, reply }),
  say: z.object({ reply: z.string().min(1).max(400) }),
} as const;

type ToolName = keyof typeof ARGS;

export const AGENT_TOOLS: readonly ToolSpec[] = [
  {
    name: 'create_bill',
    description: 'Items sold to a customer. Optionally the customer, how much was paid, how much is udhaar (credit), and a discount, GST or round-off that was spoken.',
    parameters: obj(
      {
        customer: text('Customer name as spoken. Leave out if none was named.'),
        items: { type: 'array', items: itemJson },
        amount_paid: int('Rupees paid now, only if spoken.'),
        udhaar_amount: int('Rupees on credit (udhaar), only if spoken.'),
        discount_amount: int('Discount in rupees, only if spoken.'),
        discount_percent: int('Discount percent, only if spoken.'),
        gst_percent: int('GST percent, only if spoken.'),
        round_off: { type: 'boolean', description: 'True if the speaker asked to round off.' },
      },
      ['items'],
    ),
    schema: ARGS.create_bill,
  },
  {
    name: 'record_payment',
    description: 'A customer paid money towards their udhaar ("Verma ji ne do sau de diye").',
    parameters: obj({ customer: text('Customer name as spoken.'), amount: int('Rupees paid, as spoken.') }, ['customer', 'amount']),
    schema: ARGS.record_payment,
  },
  {
    name: 'query_balance',
    description: 'Asking how much udhaar one customer owes.',
    parameters: obj({ customer: text('Customer name as spoken.') }, ['customer']),
    schema: ARGS.query_balance,
  },
  { name: 'query_summary', description: "Asking about the shop's totals today (sales, bills, total udhaar).", parameters: obj({}), schema: ARGS.query_summary },
  {
    name: 'out_of_stock',
    description: 'A product has run out ("aata khatam ho gaya").',
    parameters: obj({ product: text('Product name as spoken.') }, ['product']),
    schema: ARGS.out_of_stock,
  },
  {
    name: 'add_customer',
    description: 'Add a new customer to the list ("Anil Singh ko customer mein add karo").',
    parameters: obj({ name: text('Customer name as spoken.') }, ['name']),
    schema: ARGS.add_customer,
  },
  {
    name: 'add_product',
    description: 'Add one new product to the Samaan list with its rate. If the rate was not spoken, use `say` to ask for it.',
    parameters: obj({ name: text('Product name as spoken.'), unit: unitProp, rate: int('Spoken rate in rupees per unit.') }, ['name', 'rate']),
    schema: ARGS.add_product,
  },
  {
    name: 'add_products',
    description: 'Add several new products to the Samaan list in one sentence, each with a spoken rate.',
    parameters: obj({ products: { type: 'array', items: productJson } }, ['products']),
    schema: ARGS.add_products,
  },
  {
    name: 'update_price',
    description: "Change an existing product's rate ('chawal ka rate 45 karo').",
    parameters: obj({ product: text('Product name as spoken.'), unit: unitProp, rate: int('The new spoken rate in rupees per unit.') }, ['product', 'rate']),
    schema: ARGS.update_price,
  },
  {
    name: 'say',
    description: 'Anything else: a greeting, an unclear sentence, a request you cannot do, or a question back (for example the rate of a new product). Only a short spoken reply.',
    parameters: { type: 'object', properties: { reply: REPLY }, required: ['reply'] },
    schema: ARGS.say,
  },
];

export interface Interpreted {
  parsed: ParsedUtterance;
  /** The model's reply template, still unvalidated: draft building checks it and fills the placeholders. */
  reply: string | null;
}

const base = (p: Partial<ParsedUtterance>): ParsedUtterance => ({
  intent: 'unknown',
  customer: null,
  items: [],
  amount_paid: null,
  udhaar_amount: null,
  confidence: 0.9,
  ...p,
});

const productItem = (n: string, u: z.infer<typeof unit>, amount: number): ParsedItemOutput => ({
  name: n,
  quantity: 1,
  unit: u ?? null,
  spokenPrice: { amount, basis: 'unit', unit: u ?? null },
});

/**
 * Turns the model's tool call into a ParsedUtterance, or null when the call is not trustworthy
 * (unknown tool, bad arguments, or an amount the speaker never said).
 */
export function interpretToolCall(call: ToolCall, transcript: string): Interpreted | null {
  const tool = call.name as ToolName;
  if (!(tool in ARGS)) return null;
  const checked = ARGS[tool].safeParse(call.args);
  if (!checked.success) return null;
  const said = spokenNumbers(transcript);
  const ok = (...amounts: (number | null | undefined)[]): boolean => amounts.every((n) => n === null || n === undefined || said.has(n));
  const a = checked.data as Record<string, unknown> & { reply?: string | null };
  const out = (parsed: ParsedUtterance): Interpreted => ({ parsed, reply: a.reply ?? null });

  switch (tool) {
    case 'create_bill': {
      const d = ARGS.create_bill.parse(call.args);
      if (!ok(d.amount_paid, d.udhaar_amount, d.discount_amount, d.discount_percent, d.gst_percent, ...d.items.map((i) => i.quoted_price?.amount))) return null;
      const adjust = billAdjustSchema.safeParse({
        ...(d.discount_amount ? { discountAmount: d.discount_amount } : {}),
        ...(d.discount_percent ? { discountPercent: d.discount_percent } : {}),
        ...(d.gst_percent ? { gstPercent: d.gst_percent } : {}),
        ...(d.round_off ? { roundOff: true } : {}),
      });
      if (!adjust.success) return null;
      const hasAdjust = Object.keys(adjust.data).length > 0;
      return out(
        base({
          intent: 'create_bill',
          customer: d.customer ?? null,
          items: d.items.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unit: i.unit ?? null,
            ...(i.quoted_price ? { spokenPrice: { amount: i.quoted_price.amount, basis: i.quoted_price.per, unit: null } } : {}),
          })),
          amount_paid: d.amount_paid ?? null,
          udhaar_amount: d.udhaar_amount ?? null,
          ...(hasAdjust ? { adjust: adjust.data } : {}),
        }),
      );
    }
    case 'record_payment': {
      const d = ARGS.record_payment.parse(call.args);
      return ok(d.amount) ? out(base({ intent: 'record_payment', customer: d.customer, amount_paid: d.amount })) : null;
    }
    case 'query_balance':
      return out(base({ intent: 'query_balance', customer: ARGS.query_balance.parse(call.args).customer }));
    case 'query_summary':
      return out(base({ intent: 'query_summary' }));
    case 'out_of_stock':
      return out(base({ intent: 'out_of_stock', items: [{ name: ARGS.out_of_stock.parse(call.args).product, quantity: 1, unit: null }] }));
    case 'add_customer':
      return out(base({ intent: 'add_customer', customer: ARGS.add_customer.parse(call.args).name }));
    case 'add_product': {
      const d = ARGS.add_product.parse(call.args);
      return ok(d.rate) ? out(base({ intent: 'add_product', items: [productItem(d.name, d.unit, d.rate)] })) : null;
    }
    case 'add_products': {
      const d = ARGS.add_products.parse(call.args);
      return ok(...d.products.map((p) => p.rate))
        ? out(base({ intent: 'add_products', items: d.products.map((p) => productItem(p.name, p.unit, p.rate)) }))
        : null;
    }
    case 'update_price': {
      const d = ARGS.update_price.parse(call.args);
      return ok(d.rate) ? out(base({ intent: 'update_price', items: [productItem(d.product, d.unit, d.rate)] })) : null;
    }
    case 'say':
      return out(base({ intent: 'unknown', confidence: 0.5 }));
  }
}
