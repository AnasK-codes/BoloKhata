import type { DraftMessage } from '../protocol/server';
import { udhaarNeedsCustomer } from './ledger';

/**
 * Whether a draft can be saved (by a tap or a spoken "haan"). One rule for the gateway and the
 * browser, so the voice never says "saved" for something the browser refuses to save.
 * A bill needs items that all resolved, no open question, and a customer with details for any udhaar; a payment needs
 * a known customer; the add and update drafts need something new to write.
 */
export function isConfirmable(draft: DraftMessage): boolean {
  switch (draft.intent) {
    case 'create_bill': {
      const bill = draft.bill;
      if (!bill || bill.items.length === 0 || draft.unresolved.length > 0 || draft.clarification !== undefined) return false;
      return !udhaarNeedsCustomer(bill.udhaar, draft.customer !== undefined) && !(bill.udhaar > 0 && draft.customer?.creditReady === false);
    }
    case 'record_payment':
      return draft.customer?.id !== undefined && draft.payment !== undefined;
    case 'out_of_stock':
      return draft.stock !== undefined;
    case 'add_products':
      return draft.products?.some((p) => p.isNew && p.id === undefined) === true;
    case 'update_price':
      return draft.product?.id !== undefined && draft.product.pricePerUnit !== draft.product.previousPrice;
    case 'add_product':
      return draft.product?.isNew === true && draft.product.id === undefined;
    case 'add_customer':
      return draft.customer?.isNew === true && draft.customer.id === undefined;
    default:
      return false;
  }
}
