'use client';

import type { DraftMessage } from '@bolbill/shared';
import { formatDate, rupees } from '@/lib/format';
import { useLive } from '@/lib/db/live';
import type { Repo } from '@/lib/db/repo';

/** "Sharma ji ka kitna udhaar hai?" The number comes from the local ledger, not the draft, so it is always current. */
export function BalanceCard({ draft, repo }: { draft: DraftMessage; repo: Repo | null }) {
  const id = draft.customer?.id;
  const rows = useLive(repo && id ? () => repo.getCustomerStatement(id) : null, [repo, id]);
  const balance = rows.data?.at(-1)?.balance ?? draft.balance?.balance;
  if (balance === undefined) return null;
  const recent = (rows.data ?? []).slice(-3).reverse();
  return (
    <article className="pop rounded-2xl bg-[#1d2128] p-4" aria-label="Balance">
      <p className="text-stone-300">{draft.customer?.name}</p>
      <p className={`num text-5xl font-extrabold ${balance > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{rupees(Math.abs(balance))}</p>
      <p className="text-stone-300">{balance > 0 ? 'udhaar baaki hai' : balance < 0 ? 'zyada diya hua (advance)' : 'koi udhaar nahi'}</p>
      {recent.length > 0 && (
        <ul className="num mt-3 divide-y divide-stone-700/70 text-base">
          {recent.map((r) => (
            <li key={r.entry.id} className="flex justify-between py-2">
              <span>{formatDate(r.entry.createdAt)} · {r.entry.type === 'udhaar' ? 'Udhaar' : 'Payment'}</span>
              <span className={r.entry.type === 'udhaar' ? 'text-amber-300' : 'text-emerald-300'}>{r.entry.type === 'udhaar' ? '+' : '−'}{rupees(r.entry.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** `saved` is true once the payment is in the ledger: the balance then already includes it. */
export function PaymentCard({ draft, repo, saved }: { draft: DraftMessage; repo: Repo | null; saved: boolean }) {
  const id = draft.customer?.id;
  const rows = useLive(repo && id ? () => repo.getCustomerStatement(id) : null, [repo, id]);
  const amount = draft.payment?.amount ?? 0;
  const current = rows.data?.at(-1)?.balance;
  return (
    <article className="pop rounded-2xl bg-[#1d2128] p-4" aria-label="Payment">
      <p className="text-stone-300">{saved ? '✓ Likh liya' : 'Payment mila'} · {draft.customer?.name ?? 'grahak?'}</p>
      <p className="num text-5xl font-extrabold text-emerald-300">{rupees(amount)}</p>
      {current !== undefined && (saved ? (
        <p className="num text-stone-300">Ab baaki udhaar: <strong className="text-white">{rupees(current)}</strong></p>
      ) : (
        <p className="num text-stone-300">Baaki udhaar: {rupees(current)} → <strong className="text-white">{rupees(current - amount)}</strong></p>
      ))}
      {draft.warnings.map((w) => <p key={w} className="mt-2 text-sm text-amber-200">⚠ {w}</p>)}
    </article>
  );
}
