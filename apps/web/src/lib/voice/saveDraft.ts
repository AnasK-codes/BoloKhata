import type { DraftMessage } from '@bolbill/shared';
import type { Repo } from '../db/repo';

export type SaveOutcome =
  | { kind: 'bill'; created: boolean }
  | { kind: 'payment'; created: boolean; balanceAfter: number }
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
      });
      return { kind: 'bill', created: result.created };
    }
    if (draft.intent === 'record_payment' && draft.customer?.id && draft.payment) {
      const result = await repo.addPayment(draft.customer.id, draft.payment.amount, { draftId: draft.draftId });
      return result.ok
        ? { kind: 'payment', created: result.created, balanceAfter: result.balanceAfter }
        : { kind: 'error', message: result.error };
    }
    return { kind: 'error', message: 'Nothing to save.' };
  } catch {
    return { kind: 'error', message: 'Save nahi ho paya. Please try again.' };
  }
}
