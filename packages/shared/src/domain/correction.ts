import { LIMITS } from '../protocol/constants';
import type { DraftMessage } from '../protocol/server';
import type { CatalogProduct } from '../protocol/client';
import { billReadback } from '../voice/responses';
import { CatalogIndex, devanagariToLatin } from './matching';
import { extractQuantityAndUnit, tokenizeSpeech } from './numberWords';
import { computeTotals } from './adjustments';
import { convertToMilli, lineTotal, repriceBillItem } from './pricing';

export type CorrectionResult = { draft: DraftMessage; applied: boolean };

/** Explicit edit commands only: an ordinary new order continues through the usual parser. */
export function correctDraft(base: DraftMessage, text: string, products: readonly CatalogProduct[]): CorrectionResult | null {
  if (base.intent !== 'create_bill' || !base.bill) return null;
  const speech = devanagariToLatin(text).toLowerCase().replace(/[.,!?]/g, ' ').trim();
  if (/\b(cancel|radd)\b/.test(speech) || /^(nahi|nahin|na|no)(\s+ji)?$/.test(speech)) return null;
  const remove = /\b(hatao|hata|remove|nikalo|nikaal)\b/.test(speech);
  const add = /\b(jodo|jod|add|daalo|dalo)\b/.test(speech);
  const replace = /\b(karo|kardo|kar do|badlo|badal|change|set)\b/.test(speech) || /\b(nahi|nahin)\b/.test(speech);
  if (!remove && !add && !replace) return null;
  const fail = (): CorrectionResult => ({ applied: false, draft: { ...base,
    replyText: ['Badlav samajh nahi aaya. Item aur quantity saaf bolo.'],
    warnings: ['Badlav nahi hua. Bill check karo.'],
  } });
  if (base.unresolved.length > 0 || /\b(mat|dont|kam|ghatao|decrease|increase)\b/.test(speech) ||
    (remove && /\b(nahi|nahin)\b/.test(speech))) return fail();
  // A correction changes exactly one product. Never silently apply half of a multi-item command.
  if (/\b(aur|and)\b/.test(speech.replace(/\baur (jodo|jod|add|dalo|daalo)\b/g, ''))) return fail();
  const parts = speech.split(/\b(?:nahi|nahin)\b/);
  const tokens = tokenizeSpeech(parts.at(-1) ?? speech);
  let quantity: ReturnType<typeof extractQuantityAndUnit> = null;
  let quantityStart = -1;
  for (let i = 0; i < tokens.length; i++) {
    const found = extractQuantityAndUnit(tokens.slice(i));
    if (found) { quantity = found; quantityStart = i; break; }
  }
  const commandWords = /\b(hatao|hata|remove|nikalo|nikaal|jodo|jod|add|daalo|dalo|karo|kardo|kar|do|badlo|badal|change|set|quantity|ko|ki|ka|bhi|please|aur)\b/g;
  let name: string;
  if (parts.length > 1) {
    const left = tokenizeSpeech(parts[0] ?? '');
    const words: string[] = [];
    for (let i = 0; i < left.length;) {
      const oldQuantity = extractQuantityAndUnit(left.slice(i));
      if (oldQuantity) i += oldQuantity.consumed;
      else { words.push(left[i]!); i++; }
    }
    name = words.join(' ').replace(commandWords, ' ');
  } else {
    name = tokens.filter((_, i) => !quantity || i < quantityStart || i >= quantityStart + quantity.consumed).join(' ').replace(commandWords, ' ');
  }
  name = name.replace(/\s+/g, ' ').trim();
  const matchingProducts = [...products];
  for (const item of base.bill.items) {
    if (!matchingProducts.some((p) => p.id === item.productId)) matchingProducts.push({ id: item.productId, name: item.name, aliases: [], unit: item.unit, pricePerUnit: item.unitPrice ?? 0 });
  }
  const index = new CatalogIndex(matchingProducts);
  const match = index.matchProduct(name);
  if (!match.best || match.ambiguous) return fail();
  const product = matchingProducts.find((p) => p.id === match.best?.id);
  if (!product) return fail();
  const items = base.bill.items.map((i) => ({ ...i }));
  const positions = items.flatMap((i, pos) => i.productId === product.id ? [pos] : []);
  if (positions.length > 1) return fail();
  const position = positions[0];
  if (remove) {
    if (position === undefined) return fail();
    items.splice(position, 1);
  } else {
    if (!quantity) return fail();
    const existing = position === undefined ? undefined : items[position];
    const targetUnit = existing?.unit ?? product.unit;
    const milli = convertToMilli(quantity.quantity, quantity.unit ?? targetUnit, targetUnit);
    if (milli === null || milli <= 0 || milli > 1_000_000_000) return fail();
    if (!add && position === undefined) return fail();
    const nextMilli = add && existing ? Math.round(existing.quantity * 1000) + milli : milli;
    const item = existing ? repriceBillItem(existing, nextMilli / 1000) : { productId: product.id, name: product.name, unit: product.unit,
      quantity: nextMilli / 1000, unitPrice: product.pricePerUnit, lineTotal: lineTotal(nextMilli, product.pricePerUnit) };
    if (!item) return fail();
    if (position === undefined) {
      if (items.length >= LIMITS.maxBillItems) return fail();
      items.push(item);
    } else items[position] = item;
  }
  const total = computeTotals(items.reduce((sum, item) => sum + item.lineTotal, 0), base.bill.adjust).total;
  // A fully paid draft stays fully paid; a credit draft keeps the paid amount, capped at total.
  const paid = base.bill.udhaar === 0 ? total : Math.min(base.bill.paid, total);
  const bill = { items, total, paid, udhaar: total - paid, ...(base.bill.adjust ? { adjust: base.bill.adjust } : {}) };
  const replyText = items.length === 0 ? ['Bill mein koi item nahi bacha. Naya item jodo.'] : billReadback({
    ...(base.customer ? { customerName: base.customer.name } : {}), total, udhaar: bill.udhaar,
  });
  return { applied: true, draft: { ...base, bill, warnings: [], replyText } };
}
