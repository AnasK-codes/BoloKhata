import {
  LIMITS,
  buildBill,
  type BuildBillResult,
  type CatalogIndex,
  type ParsedUtterance,
  type UnresolvedItem,
} from '@bolbill/shared';

export interface ResolvedCustomer {
  name: string;
  /** Set only when the spoken name matched exactly one known customer. */
  id?: string;
  /** Matched nobody: a new customer the user can confirm. */
  isNew: boolean;
  /** Set when two customers matched about equally; the user must choose. */
  ambiguous?: UnresolvedItem;
}

export interface Resolution {
  customer: ResolvedCustomer | null;
  /** Priced from the catalog by shared code. Only for create_bill. */
  bill: BuildBillResult | null;
}

/**
 * Turns a parsed utterance (from rules OR from the LLM) into catalog facts: which customer, which
 * products, what they cost. This is the only place prices appear, and it is plain code: whatever a
 * model said, the numbers come from the catalog snapshot.
 */
export function resolveUtterance(parsed: ParsedUtterance, index: CatalogIndex): Resolution {
  const customer = resolveCustomer(parsed.customer, index);
  const bill =
    parsed.intent === 'create_bill'
      ? buildBill({
          parsedItems: parsed.items,
          products: index,
          ...(customer?.id ? { customerId: customer.id } : {}),
          amountPaid: parsed.amount_paid,
          udhaarAmount: parsed.udhaar_amount,
        })
      : null;
  return { customer, bill };
}

function resolveCustomer(spoken: string | null, index: CatalogIndex): ResolvedCustomer | null {
  if (spoken === null) return null;
  const match = index.matchCustomer(spoken);
  const name = spoken.slice(0, LIMITS.maxNameLength);
  if (match.ambiguous) {
    return {
      name,
      isNew: false,
      ambiguous: {
        kind: 'customer',
        spoken: name,
        candidates: match.candidates.map((c) => ({ id: c.id, name: c.name, score: c.score })),
      },
    };
  }
  if (match.best) return { name: match.best.name, id: match.best.id, isNew: false };
  return { name, isNew: match.isNew };
}

/** True when the sentence needs no human look at its items: nothing unresolved, and a bill has items. */
export function itemsResolved(parsed: ParsedUtterance, resolution: Resolution): boolean {
  if (parsed.intent !== 'create_bill') return true;
  const bill = resolution.bill;
  return bill !== null && bill.unresolvedItems.length === 0 && bill.bill.items.length > 0;
}
