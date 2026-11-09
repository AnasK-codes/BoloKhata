'use client';

import { useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { StateView, OfflineBadge } from './StateView';
import { ReverseDialog } from './ReverseDialog';
import { useLive } from '@/lib/db/live';
import { useOnline } from '@/lib/useOnline';
import { formatDate, rupees } from '@/lib/format';
import { formatDateFor, useT } from '@/lib/i18n';
import { paymentStatus, type Bill } from '@bolbill/shared';
import { receiptText } from '@/lib/receipt';
import { thermalReceipt } from '@/lib/thermalReceipt';

export function BillsScreen() {
  const t = useT();
  const { repo, dataError, toast } = useApp();
  const online = useOnline();
  const bills = useLive(repo ? () => repo.listBills() : null, [repo]);
  const customers = useLive(repo ? () => repo.listCustomers() : null, [repo]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);
  const [copyText, setCopyText] = useState<string | null>(null);
  const names = useMemo(() => new Map((customers.data ?? []).map((c) => [c.id, c.name])), [customers.data]);
  const filtered = (bills.data ?? []).filter((b) => `${b.id} ${names.get(b.customerId ?? '') ?? t('bills.cash')} ${formatDate(b.createdAt)} ${formatDateFor(b.createdAt)}`.toLowerCase().includes(query.toLowerCase()));
  const bill = bills.data?.find((b) => b.id === selected);
  const customerName = bill ? names.get(bill.customerId ?? '') : undefined;
  const text = bill ? receiptText(bill, customerName) : '';
  const thermal = bill ? thermalReceipt(bill, customerName) : '';
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: t('bills.shareTitle'), text }); return; }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); toast(t('bills.copied'), 'ok'); return; }
      setCopyText(text);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setCopyText(text);
      toast(t('bills.copyBelow'), 'info');
    }
  };
  if (dataError || bills.error || customers.error) return <main className="mx-auto max-w-md p-4"><StateView kind="error" title={t('bills.error')} hint={t('common.reloadHint')} /></main>;
  if (!repo || bills.loading || customers.loading) return <main className="p-4"><StateView kind="loading" title={t('bills.loading')} /></main>;
  return <main className="mx-auto max-w-md space-y-4 px-4 py-5">
    <OfflineBadge online={online} />
    <h1 className="text-2xl font-extrabold">{t('bills.title')}</h1>
    {bill ? <>
      <button className="min-h-12 rounded-xl bg-control px-4" onClick={() => { setSelected(null); setReversing(false); setCopyText(null); }}>← {t('common.back')}</button>
      <div className="receipt-stage">
        <div className="receipt-shadow">
          <article className="thermal-print-root receipt-paper" aria-label={t('bills.receipt')}>
            <pre className="thermal-paper m-0 text-black">{thermal}</pre>
          </article>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="min-h-12 flex-1 rounded-xl bg-accent px-4 font-bold text-on-solid" onClick={() => void share()}>{t('bills.share')}</button>
        <button className="min-h-12 flex-1 rounded-xl bg-control px-4 font-bold" onClick={() => window.print()}>{t('bills.print')}</button>
      </div>
      <p className="text-sm text-muted">{t('bills.printHint')}</p>
      {copyText && <label className="block">{t('bills.copyLabel')}<textarea readOnly value={copyText} onFocus={(e) => e.target.select()} className="min-h-48 w-full rounded-xl bg-inset p-3" /></label>}
      {bill.reversedAt === undefined && (reversing ? <ReverseDialog onCancel={() => setReversing(false)} onReverse={async (reason) => {
        const result = await repo.reverseBill(bill.id, reason);
        if (result.ok) { setReversing(false); toast(t('bills.reversedToast'), 'ok'); }
        return result;
      }} /> : <button className="min-h-12 rounded-xl bg-control px-4 font-bold text-bad" onClick={() => setReversing(true)}>{t('bills.reverse')}</button>)}
    </> : <>
      <input aria-label={t('bills.search')} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('bills.searchPlaceholder')} className="min-h-12 w-full rounded-xl bg-inset px-3" />
      {filtered.length === 0 ? <StateView kind="empty" title={query ? t('bills.noMatch') : t('bills.empty')} hint={t('bills.emptyHint')} /> : <ul className="divide-y divide-line rounded-xl bg-card">
        {filtered.map((b) => <li key={b.id}><button className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setSelected(b.id)}>
          <span><span className="block font-bold">{names.get(b.customerId ?? '') ?? t('bills.cash')}</span><span className="text-sm text-muted">{formatDateFor(b.createdAt)}{b.reversedAt !== undefined ? ` · ${t('bills.reversedTag')}` : ''}</span></span>
          <span className="text-right"><span className="num block font-bold">{rupees(b.total)}</span>{b.reversedAt === undefined && <PaymentBadge bill={b} />}</span>
        </button></li>)}
      </ul>}
    </>}
  </main>;
}

/** PAID, UNPAID (everything on khata) or PART PAID, so a khata bill is never mistaken for cash. */
function PaymentBadge({ bill }: { bill: Bill }) {
  const t = useT();
  const status = paymentStatus(bill);
  const [label, tone] = status === 'paid' ? [t('bills.paid'), 'badge'] : status === 'unpaid' ? [t('bills.unpaid'), 'badge badge-bad'] : [t('bills.partPaid'), 'badge badge-warn'];
  return <span className={tone} data-payment={status}>{label}</span>;
}
