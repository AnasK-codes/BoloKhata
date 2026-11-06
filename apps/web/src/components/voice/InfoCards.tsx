'use client';

import type { DraftMessage } from '@bolbill/shared';
import { Icon } from '../Icon';
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
    <article className="pop rounded-2xl bg-card p-4" aria-label="Balance">
      <p className="text-dim">{draft.customer?.name}</p>
      <p className={`num text-5xl font-extrabold ${balance > 0 ? 'text-warn' : 'text-good'}`}>{rupees(Math.abs(balance))}</p>
      <p className="text-dim">{balance > 0 ? 'udhaar baaki hai' : balance < 0 ? 'zyada diya hua (advance)' : 'koi udhaar nahi'}</p>
      {recent.length > 0 && (
        <ul className="num mt-3 divide-y divide-line text-base">
          {recent.map((r) => (
            <li key={r.entry.id} className="flex justify-between py-2">
              <span>{formatDate(r.entry.createdAt)} · {r.entry.type === 'udhaar' ? 'Udhaar' : 'Payment'}</span>
              <span className={r.entry.type === 'udhaar' ? 'text-warn' : 'text-good'}>{r.entry.type === 'udhaar' ? '+' : '−'}{rupees(r.entry.amount)}</span>
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
    <article className="pop rounded-2xl bg-card p-4" aria-label="Payment">
      <p className="text-dim">{saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />Likh liya</span> : 'Payment mila'} · {draft.customer?.name ?? 'grahak?'}</p>
      <p className="num text-5xl font-extrabold text-good">{rupees(amount)}</p>
      {current !== undefined && (saved ? (
        <p className="num text-dim">Ab baaki udhaar: <strong className="font-bold text-ink">{rupees(current)}</strong></p>
      ) : (
        <p className="num text-dim">Baaki udhaar: {rupees(current)} → <strong className="font-bold text-ink">{rupees(current - amount)}</strong></p>
      ))}
      {draft.warnings.map((w) => <p key={w} className="mt-2 flex gap-2 text-sm text-warn"><Icon name="alert" size={18} />{w}</p>)}
    </article>
  );
}

/** "Aaj kitni bikri hui?" The numbers come from the device's own bills and ledger, sent in the snapshot. */
export function SummaryCard({ draft }: { draft: DraftMessage }) {
  const s = draft.summary;
  if (!s) return null;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label="Aaj ka hisab">
      <p className="mb-3 font-semibold text-dim">Aaj ka hisab</p>
      <div className="stat-grid num">
        <div className="stat stat-wide">
          <small>Aaj ki bikri</small>
          <strong className="text-good">{rupees(s.todaySales)}</strong>
        </div>
        <div className="stat">
          <small>Bill bane</small>
          <strong>{s.todayBills}</strong>
        </div>
        <div className="stat">
          <small>Kul udhaar baaki</small>
          <strong className={s.totalUdhaar > 0 ? 'text-warn' : 'text-good'}>{rupees(s.totalUdhaar)}</strong>
        </div>
      </div>
    </article>
  );
}

/** "Aata khatam ho gaya": waits for a tap or a spoken "haan" before the stock is written. */
export function StockCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  if (!draft.stock) return null;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label="Stock">
      <p className="text-dim">
        {saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />Likh liya</span> : <span className="badge badge-warn">Confirm karo</span>}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{draft.stock.name}</p>
      <p className="mt-1 text-dim">{saved ? 'Stock 0 ho gaya. Samaan mein "Khatam" dikhega.' : 'Khatam likhun? Confirm dabao ya bolo "haan".'}</p>
    </article>
  );
}

/** "Anil Singh ko customer mein add karo": waits for a tap or a spoken "haan" before the customer is created. */
export function CustomerCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  if (!draft.customer) return null;
  const exists = !draft.customer.isNew;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label="Naya customer">
      <p className="text-dim">
        {exists ? <span className="badge">Pehle se hai</span> : saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />Customer jod diya</span> : <span className="badge badge-warn">Confirm karo</span>}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{draft.customer.name}</p>
      <p className="mt-1 text-dim">
        {exists ? 'Khata mein ye customer pehle se maujood hai.' : saved ? 'Khata mein dikhega. Udhaar ke liye mobile aur address baad mein bharo.' : 'Naya customer jodun? Confirm dabao ya bolo "haan".'}
      </p>
    </article>
  );
}

const UNIT_LABEL: Record<string, string> = { kg: 'kg', g: 'gram', l: 'litre', ml: 'ml', piece: 'piece', packet: 'packet', dozen: 'darjan' };

/** "Samaan mein chawal 40 rupaye kilo": waits for a tap or a spoken "haan" before the product is created. */
export function ProductCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  const product = draft.product;
  if (!product) return null;
  const changing = product.previousPrice !== undefined;
  const exists = !product.isNew && !changing;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={changing ? 'Rate badalna' : 'Naya samaan'}>
      <p className="text-dim">
        {exists ? <span className="badge">Pehle se hai</span> : saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{changing ? 'Rate badal diya' : 'Samaan jod diya'}</span> : <span className="badge badge-warn">Confirm karo</span>}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{product.name}</p>
      <p className="num mt-1 text-2xl font-bold">{changing && <span className="mr-2 text-lg font-semibold text-dim line-through">{rupees(product.previousPrice ?? 0)}</span>}{rupees(product.pricePerUnit)}<span className="text-base font-semibold text-dim"> / {UNIT_LABEL[product.unit] ?? product.unit}</span></p>
      <p className="mt-1 text-dim">
        {changing
          ? saved ? 'Naya rate ab se naye bill mein lagega. Purane bill nahi badlenge.' : 'Rate badal dun? Confirm dabao ya bolo "haan".'
          : exists ? 'Ye samaan list mein pehle se hai. Rate badalna ho to bolo: "chawal ka rate 45 karo".' : saved ? 'Samaan mein dikhega. Ab bill mein bol sakte ho.' : 'Samaan mein jodun? Confirm dabao ya bolo "haan".'}
      </p>
    </article>
  );
}

/** "Samaan mein aata 45, cheeni 50, ...": the whole list, one confirmation. Existing products are marked and skipped. */
export function ProductListCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  const products = draft.products;
  if (!products || products.length === 0) return null;
  const fresh = products.filter((p) => p.isNew).length;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label="Naye samaan">
      <p className="text-dim">
        {fresh === 0 ? <span className="badge">Sab pehle se hain</span> : saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{fresh} samaan jod diye</span> : <span className="badge badge-warn">{fresh} naye, confirm karo</span>}
      </p>
      <ul className="mt-3 divide-y divide-black/5">
        {products.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
            <span className={`text-lg font-bold ${p.isNew ? '' : 'text-dim line-through'}`}>{p.name}</span>
            <span className="num text-lg font-semibold">
              {rupees(p.pricePerUnit)}<span className="text-sm text-dim"> / {UNIT_LABEL[p.unit] ?? p.unit}</span>
              {!p.isNew && <span className="badge ml-2">Pehle se hai</span>}
            </span>
          </li>
        ))}
      </ul>
      {!saved && fresh > 0 && <p className="mt-2 text-dim">Sab sahi hai? Confirm dabao ya bolo "haan".</p>}
    </article>
  );
}
