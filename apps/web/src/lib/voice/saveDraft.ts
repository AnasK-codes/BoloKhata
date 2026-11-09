import type { DraftMessage } from '@bolbill/shared';
import type { Repo } from '../db/repo';
import { validateProductForm } from '../catalogForm';
import { t } from '../i18n';

/** The form validator takes the quantity as text; an absent quantity means stock is not tracked. */
const stockText = (stock: number | undefined): string => (stock === undefined ? '' : String(stock));

export type SaveOutcome =
  | { kind: 'bill'; created: boolean }
  | { kind: 'payment'; created: boolean; balanceAfter: number }
  | { kind: 'stock'; created: boolean }
  | { kind: 'customer'; created: boolean }
  | { kind: 'product'; created: boolean }
  | { kind: 'price'; created: boolean }
  | { kind: 'products'; created: number }
  | { kind: 'error'; message: string };

/**
 * Writes a confirmed draft to the local ledger. Called for a tap and for a spoken "haan" alike;
 * the draft id makes the second of two quick confirmations a no-op.
 */
export async function saveDraft(repo: Repo, draft: DraftMessage): Promise<SaveOutcome> {
  try {
    if (draft.intent === 'create_bill' && draft.bill) {
      const result = await repo.saveBillWithLedger({
        draftId: draft.draftId,
        ...(draft.customer?.id ? { customerId: draft.customer.id } : draft.customer ? { customerName: draft.customer.name } : {}),
        items: draft.bill.items,
        total: draft.bill.total,
        paid: draft.bill.paid,
        udhaar: draft.bill.udhaar,
        ...(draft.bill.adjust ? { adjust: draft.bill.adjust } : {}),
      });
      return { kind: 'bill', created: result.created };
    }
    if (draft.intent === 'record_payment' && draft.customer?.id && draft.payment) {
      const result = await repo.addPayment(draft.customer.id, draft.payment.amount, { draftId: draft.draftId });
      return result.ok
        ? { kind: 'payment', created: result.created, balanceAfter: result.balanceAfter }
        : { kind: 'error', message: result.error };
    }
    if (draft.intent === 'out_of_stock' && draft.stock) {
      const result = await repo.setStock(draft.stock.productId, 0);
      return result.ok ? { kind: 'stock', created: true } : { kind: 'error', message: result.error };
    }
    if (draft.intent === 'add_customer' && draft.customer) {
      // A second confirmation (tap plus "haan") finds the customer the first one made.
      if (await repo.findCustomerByName(draft.customer.name)) return { kind: 'customer', created: false };
      const result = await repo.saveCustomer({ name: draft.customer.name, aliases: [] });
      return result.ok ? { kind: 'customer', created: true } : { kind: 'error', message: result.error };
    }
    if (draft.intent === 'add_product' && draft.product) {
      // The same rules as the Samaan form, so a spoken product can never be one the form would refuse.
      const form = validateProductForm({ name: draft.product.name, price: String(draft.product.pricePerUnit), unit: draft.product.unit, aliases: '', stock: stockText(draft.product.stock) });
      if (!form.ok) return { kind: 'error', message: Object.values(form.errors)[0] ?? t('save.itemFailed') };
      // A second confirmation (tap plus "haan") finds the product the first one made.
      if (await repo.findProductByName(form.value.name)) return { kind: 'product', created: false };
      await repo.upsertProduct({ name: form.value.name, aliases: [], unit: form.value.unit, pricePerUnit: form.value.pricePerUnit, ...(form.value.stock !== undefined ? { stock: form.value.stock } : {}) });
      return { kind: 'product', created: true };
    }
    if (draft.intent === 'add_products' && draft.products) {
      // Validate every new row first so a bad one never leaves the list half saved.
      const rows = draft.products.filter((p) => p.isNew).map((p) => validateProductForm({ name: p.name, price: String(p.pricePerUnit), unit: p.unit, aliases: '', stock: stockText(p.stock) }));
      const bad = rows.find((r) => !r.ok);
      if (bad && !bad.ok) return { kind: 'error', message: Object.values(bad.errors)[0] ?? t('save.itemFailed') };
      let created = 0;
      for (const row of rows) {
        if (!row.ok || (await repo.findProductByName(row.value.name))) continue;
        await repo.upsertProduct({ name: row.value.name, aliases: [], unit: row.value.unit, pricePerUnit: row.value.pricePerUnit, ...(row.value.stock !== undefined ? { stock: row.value.stock } : {}) });
        created++;
      }
      return { kind: 'products', created };
    }
    if (draft.intent === 'update_price' && draft.product?.id) {
      const result = await repo.setProductPrice(draft.product.id, draft.product.pricePerUnit);
      return result.ok ? { kind: 'price', created: result.changed } : { kind: 'error', message: result.error };
    }
    return { kind: 'error', message: t('save.nothing') };
  } catch (error) {
    if (error instanceof Error && error.message === 'CREDIT_DETAILS_REQUIRED') {
      return { kind: 'error', message: t('save.creditDetails') };
    }
    return { kind: 'error', message: t('save.failed') };
  }
}

/** The toast for a save that wrote something, or null when there is nothing to announce. */
export function savedMessage(outcome: SaveOutcome): string | null {
  switch (outcome.kind) {
    case 'bill': return outcome.created ? t('saved.bill') : null;
    case 'payment': return outcome.created ? t('saved.payment') : null;
    case 'stock': return outcome.created ? t('saved.stock') : null;
    case 'customer': return outcome.created ? t('info.customerAdded') : null;
    case 'product': return outcome.created ? t('info.itemAdded') : null;
    case 'price': return outcome.created ? t('info.rateChanged') : null;
    case 'products': return outcome.created > 0 ? t('info.itemsAdded', { count: outcome.created }) : null;
    case 'error': return null;
  }
}
