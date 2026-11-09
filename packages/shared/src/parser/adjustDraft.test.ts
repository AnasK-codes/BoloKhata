import { describe, expect, it } from 'vitest';
import type { DraftMessage } from '../protocol/server';
import { seedIndex } from '../testing/seed';
import { adjustDraft } from './adjustDraft';
import { parseUtterance } from './ruleBased';

/** Maggi 3 x 14 = 42, Cheeni 1 x 50 = 50: subtotal 92. */
function draft(over: Partial<DraftMessage> = {}, paid = 92): DraftMessage {
  return {
    type: 'draft', turnId: 1, draftId: 'd1', intent: 'create_bill', source: 'rules', confidence: 0.9,
    bill: {
      items: [
        { productId: 'p1', name: 'Maggi', quantity: 3, unit: 'packet', unitPrice: 14, lineTotal: 42 },
        { productId: 'p2', name: 'Cheeni', quantity: 1, unit: 'kg', unitPrice: 50, lineTotal: 50 },
      ],
      total: 92, paid, udhaar: 92 - paid,
    },
    unresolved: [], warnings: [], replyText: ['Bill 92 ka hai.'],
    ...over,
  };
}

describe('adjustDraft', () => {
  it('applies a percent discount', () => {
    const r = adjustDraft(draft(), 'das percent discount');
    expect(r?.applied).toBe(true);
    expect(r?.draft.bill).toMatchObject({ total: 83, paid: 83, udhaar: 0, adjust: { discountPercent: 10 } });
  });

  it('stacks round off on the discount', () => {
    const first = adjustDraft(draft(), 'das percent discount');
    const r = adjustDraft(first!.draft, 'round off');
    expect(r?.draft.bill).toMatchObject({ total: 85, adjust: { discountPercent: 10, roundOff: true } });
  });

  it('lets a rupee discount replace a percent one', () => {
    const first = adjustDraft(draft(), 'das percent discount');
    const r = adjustDraft(first!.draft, 'paanch rupaye kam karo');
    expect(r?.draft.bill?.total).toBe(87);
    expect(r?.draft.bill?.adjust).toEqual({ discountAmount: 5 });
  });

  it('keeps the paid amount of a credit bill, capped at the new total', () => {
    const r = adjustDraft(draft({}, 50), 'das percent discount');
    expect(r?.draft.bill).toMatchObject({ total: 83, paid: 50, udhaar: 33 });
    const capped = adjustDraft(draft({}, 90), 'pachas rupaye kam karo');
    expect(capped?.draft.bill).toMatchObject({ total: 42, paid: 42, udhaar: 0 });
  });

  it('never guesses a GST rate', () => {
    const r = adjustDraft(draft(), 'GST lagao');
    expect(r?.applied).toBe(false);
    expect(r?.draft.bill?.total).toBe(92);
    expect(r?.draft.warnings.length).toBeGreaterThan(0);
    expect(r?.draft.replyText).toEqual(['GST kitna percent? Bolo, jaise paanch percent GST.']);
  });

  it('returns null for speech that is not a bare adjustment', () => {
    expect(adjustDraft(draft(), 'ek kilo aata aur das percent discount')).toBeNull();
    expect(adjustDraft(draft(), 'haan')).toBeNull();
    expect(adjustDraft(draft({ intent: 'query_balance' }), 'das percent discount')).toBeNull();
  });
});

describe('spoken number variants', () => {
  it('reads "attaais" as 28', () => {
    const r = parseUtterance('Do kilo chawal ek sau dus ke aur do Maggi attaais ke', seedIndex());
    const price = (name: string) => r.items.find((i) => i.name.toLowerCase() === name)?.spokenPrice?.amount;
    expect(price('chawal')).toBe(110);
    expect(price('maggi')).toBe(28);
  });
});
