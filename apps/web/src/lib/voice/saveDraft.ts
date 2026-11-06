import type { DraftMessage } from '@bolbill/shared';
import type { Repo } from '../db/repo';
import { validateProductForm } from '../catalogForm';

export type SaveOutcome =
  | { kind: 'bill'; created: boolean }
  | { kind: 'payment'; created: boolean; balanceAfter: number }
  | { kind: 'stock'; created: boolean }
  | { kind: 'customer'; created: boolean }
  | { kind: 'product'; created: boolean }
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
      const form = validateProductForm({ name: draft.product.name, price: String(draft.product.pricePerUnit), unit: draft.product.unit, aliases: '' });
      if (!form.ok) return { kind: 'error', message: Object.values(form.errors)[0] ?? 'Samaan save nahi ho paya.' };
      // A second confirmation (tap plus "haan") finds the product the first one made.
      if (await repo.findProductByName(form.value.name)) return { kind: 'product', created: false };
      await repo.upsertProduct({ name: form.value.name, aliases: [], unit: form.value.unit, pricePerUnit: form.value.pricePerUnit });
      return { kind: 'product', created: true };
    }
    return { kind: 'error', message: 'Nothing to save.' };
  } catch (error) {
    if (error instanceof Error && error.message === 'CREDIT_DETAILS_REQUIRED') {
      return { kind: 'error', message: 'Udhaar save karne se pehle grahak ka naam, mobile aur address bharo.' };
    }
    return { kind: 'error', message: 'Save nahi ho paya. Please try again.' };
  }
}
