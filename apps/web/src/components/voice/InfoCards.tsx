'use client';

import { useState } from 'react';
import type { DraftMessage } from '@bolbill/shared';
import { Icon } from '../Icon';
import { answerRate, dismissQuestion } from '@/lib/voice/draftEdit';
import { formatDate, rupees } from '@/lib/format';
import { useLive } from '@/lib/db/live';
import type { Repo } from '@/lib/db/repo';
import { useT } from '@/lib/i18n';
import { unitName } from './units';

/** "Sharma ji ka kitna udhaar hai?" The number comes from the local ledger, not the draft, so it is always current. */
export function BalanceCard({ draft, repo }: { draft: DraftMessage; repo: Repo | null }) {
  const t = useT();
  const id = draft.customer?.id;
  const rows = useLive(repo && id ? () => repo.getCustomerStatement(id) : null, [repo, id]);
  const balance = rows.data?.at(-1)?.balance ?? draft.balance?.balance;
  if (balance === undefined) return null;
  const recent = (rows.data ?? []).slice(-3).reverse();
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={t('balance.label')}>
      <p className="text-dim">{draft.customer?.name}</p>
      <p className={`num text-5xl font-extrabold ${balance > 0 ? 'text-warn' : 'text-good'}`}>{rupees(Math.abs(balance))}</p>
      <p className="text-dim">{balance > 0 ? t('balance.owed') : balance < 0 ? t('balance.advance') : t('balance.none')}</p>
      {recent.length > 0 && (
        <ul className="num mt-3 divide-y divide-line text-base">
          {recent.map((r) => (
            <li key={r.entry.id} className="flex justify-between py-2">
              <span>{formatDate(r.entry.createdAt)} · {r.entry.type === 'udhaar' ? t('entry.credit') : t('entry.payment')}</span>
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
  const t = useT();
  const id = draft.customer?.id;
  const rows = useLive(repo && id ? () => repo.getCustomerStatement(id) : null, [repo, id]);
  const amount = draft.payment?.amount ?? 0;
  const current = rows.data?.at(-1)?.balance;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={t('entry.payment')}>
      <p className="text-dim">{saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{t('info.recorded')}</span> : t('entry.paymentReceived')} · {draft.customer?.name ?? t('info.customerUnknown')}</p>
      <p className="num text-5xl font-extrabold text-good">{rupees(amount)}</p>
      {current !== undefined && (saved ? (
        <p className="num text-dim">{t('info.owedNow')}: <strong className="font-bold text-ink">{rupees(current)}</strong></p>
      ) : (
        <p className="num text-dim">{t('info.owed')}: {rupees(current)} → <strong className="font-bold text-ink">{rupees(current - amount)}</strong></p>
      ))}
      {draft.warnings.map((w) => <p key={w} className="mt-2 flex gap-2 text-sm text-warn"><Icon name="alert" size={18} />{w}</p>)}
    </article>
  );
}

/** "Aaj kitni bikri hui?" The numbers come from the device's own bills and ledger, sent in the snapshot. */
export function SummaryCard({ draft }: { draft: DraftMessage }) {
  const t = useT();
  const s = draft.summary;
  if (!s) return null;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={t('info.summaryTitle')}>
      <p className="mb-3 font-semibold text-dim">{t('info.summaryTitle')}</p>
      <div className="stat-grid num">
        <div className="stat stat-wide">
          <small>{t('info.salesToday')}</small>
          <strong className="text-good">{rupees(s.todaySales)}</strong>
        </div>
        <div className="stat">
          <small>{t('info.billsMade')}</small>
          <strong>{s.todayBills}</strong>
        </div>
        <div className="stat">
          <small>{t('info.totalOwed')}</small>
          <strong className={s.totalUdhaar > 0 ? 'text-warn' : 'text-good'}>{rupees(s.totalUdhaar)}</strong>
        </div>
      </div>
    </article>
  );
}

/** "Aata khatam ho gaya": waits for a tap or a spoken "haan" before the stock is written. */
export function StockCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  const t = useT();
  if (!draft.stock) return null;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={t('info.stock')}>
      <p className="text-dim">
        {saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{t('info.recorded')}</span> : <span className="badge badge-warn">{t('info.confirm')}</span>}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{draft.stock.name}</p>
      <p className="mt-1 text-dim">{saved ? t('info.stockSaved') : t('info.stockAsk')}</p>
    </article>
  );
}

/** "Anil Singh ko customer mein add karo": waits for a tap or a spoken "haan" before the customer is created. */
export function CustomerCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  const t = useT();
  if (!draft.customer) return null;
  const exists = !draft.customer.isNew;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={t('info.newCustomer')}>
      <p className="text-dim">
        {exists ? <span className="badge">{t('info.exists')}</span> : saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{t('info.customerAdded')}</span> : <span className="badge badge-warn">{t('info.confirm')}</span>}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{draft.customer.name}</p>
      <p className="mt-1 text-dim">
        {exists ? t('info.customerExists') : saved ? t('info.customerSaved') : t('info.customerAsk')}
      </p>
    </article>
  );
}

/** "Samaan mein chawal 40 rupaye kilo": waits for a tap or a spoken "haan" before the product is created. */
export function ProductCard({ draft, saved }: { draft: DraftMessage; saved: boolean }) {
  const t = useT();
  const product = draft.product;
  if (!product) return null;
  const changing = product.previousPrice !== undefined;
  const exists = !product.isNew && !changing;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={changing ? t('info.changeRate') : t('info.newItem')}>
      <p className="text-dim">
        {exists ? <span className="badge">{t('info.exists')}</span> : saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{changing ? t('info.rateChanged') : t('info.itemAdded')}</span> : <span className="badge badge-warn">{t('info.confirm')}</span>}
      </p>
      <p className="mt-2 text-3xl font-extrabold tracking-tight">{product.name}</p>
      <p className="num mt-1 text-2xl font-bold">{changing && <span className="mr-2 text-lg font-semibold text-dim line-through">{rupees(product.previousPrice ?? 0)}</span>}{rupees(product.pricePerUnit)}<span className="text-base font-semibold text-dim"> / {unitName(t, product.unit)}</span></p>
      {product.isNew && (
        <p className={`num mt-1 text-lg font-semibold ${product.stock === undefined ? 'text-warn' : ''}`}>
          {product.stock !== undefined ? t('catalog.stockLine', { stock: product.stock, unit: unitName(t, product.unit) }) : t('info.noStock')}
        </p>
      )}
      <p className="mt-1 text-dim">
        {changing
          ? saved ? t('info.rateSaved') : t('info.rateAsk')
          : exists ? t('info.itemExists') : saved ? t('info.itemSaved') : t('info.itemAsk')}
      </p>
    </article>
  );
}

/** "Samaan mein aata 45, cheeni 50, ...": the whole list, one confirmation. Existing products are marked and skipped. */
export function ProductListCard({ draft, saved, onChange }: { draft: DraftMessage; saved: boolean; onChange?(draft: DraftMessage): void }) {
  const t = useT();
  const products = draft.products ?? [];
  const asking = draft.clarification?.slot === 'rate' ? draft.clarification : undefined;
  if (products.length === 0 && !asking) return null;
  const fresh = products.filter((p) => p.isNew).length;
  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label={t('info.newItems')}>
      <p className="text-dim">
        {asking ? <span className="badge badge-warn">{t('info.pendingRate')}</span> : fresh === 0 ? <span className="badge">{t('info.allExist')}</span> : saved ? <span className="inline-flex items-center gap-1 text-good"><Icon name="check" size={18} />{t('info.itemsAdded', { count: fresh })}</span> : <span className="badge badge-warn">{t('info.newCount', { count: fresh })}</span>}
      </p>
      <ul className="mt-3 divide-y divide-black/5">
        {products.map((p, i) => (
          <li key={`${p.name}-${i}`} className="flex items-center justify-between gap-3 py-2">
            <span>
              <span className={`block text-lg font-bold ${p.isNew ? '' : 'text-dim line-through'}`}>{p.name}</span>
              {p.isNew && <span className={`num block text-sm ${p.stock === undefined ? 'text-warn' : 'text-dim'}`}>{p.stock !== undefined ? t('catalog.stockLine', { stock: p.stock, unit: unitName(t, p.unit) }) : t('info.noStock')}</span>}
            </span>
            <span className="num text-lg font-semibold">
              {rupees(p.pricePerUnit)}<span className="text-sm text-dim"> / {unitName(t, p.unit)}</span>
              {!p.isNew && <span className="badge ml-2">{t('info.exists')}</span>}
            </span>
          </li>
        ))}
      </ul>
      {asking && onChange && <RateAsk draft={draft} onChange={onChange} />}
      {!saved && fresh > 0 && !asking && <p className="mt-2 text-dim">{t('info.allCorrect')}</p>}
    </article>
  );
}

/** "Rajma ka rate kitna hai?" as a field: type the rate instead of saying it again. */
function RateAsk({ draft, onChange }: { draft: DraftMessage; onChange(draft: DraftMessage): void }) {
  const t = useT();
  const ask = draft.clarification;
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (ask?.slot !== 'rate') return null;
  const unit = unitName(t, ask.unit ?? 'piece');
  const submit = () => {
    const amount = Number(text.trim());
    if (!Number.isInteger(amount) || amount <= 0) { setError(t('info.rateInvalid')); return; }
    setError('');
    onChange(answerRate(draft, amount));
  };
  return (
    <form className="note-pick mt-3 rounded-xl ring-2 ring-warn p-3" noValidate aria-current="step" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <label htmlFor="rate-answer" className="block font-semibold">{t('info.rateFor', { name: ask.spoken ?? '' })}</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input id="rate-answer" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('info.rateField', { unit })}
          aria-label={t('info.rateField', { unit })} aria-invalid={error !== ''} aria-describedby={error ? 'rate-answer-error' : undefined}
          className="num min-h-12 w-full basis-full rounded-xl bg-inset px-3 text-lg" />
        <button type="submit" className="min-h-12 flex-1 rounded-xl bg-accent px-4 font-bold text-on-solid">{t('info.rateAdd')}</button>
        <button type="button" className="min-h-12 rounded-xl bg-control px-4 font-semibold" onClick={() => onChange(dismissQuestion(draft))}>{t('common.cancel')}</button>
      </div>
      {error && <p id="rate-answer-error" role="alert" className="mt-1 text-bad">{error}</p>}
    </form>
  );
}
