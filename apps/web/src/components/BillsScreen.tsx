'use client';

import { useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { StateView, OfflineBadge } from './StateView';
import { ReverseDialog } from './ReverseDialog';
import { useLive } from '@/lib/db/live';
import { useOnline } from '@/lib/useOnline';
import { formatDate, rupees } from '@/lib/format';
import { receiptText } from '@/lib/receipt';
import { thermalReceipt } from '@/lib/thermalReceipt';

export function BillsScreen() {
  const { repo, dataError, toast } = useApp();
  const online = useOnline();
  const bills = useLive(repo ? () => repo.listBills() : null, [repo]);
  const customers = useLive(repo ? () => repo.listCustomers() : null, [repo]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);
  const [copyText, setCopyText] = useState<string | null>(null);
  const names = useMemo(() => new Map((customers.data ?? []).map((c) => [c.id, c.name])), [customers.data]);
  const filtered = (bills.data ?? []).filter((b) => `${b.id} ${names.get(b.customerId ?? '') ?? 'Cash'} ${formatDate(b.createdAt)}`.toLowerCase().includes(query.toLowerCase()));
  const bill = bills.data?.find((b) => b.id === selected);
  const customerName = bill ? names.get(bill.customerId ?? '') : undefined;
  const text = bill ? receiptText(bill, customerName) : '';
  const thermal = bill ? thermalReceipt(bill, customerName) : '';
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: 'Bol-Bill receipt', text }); return; }
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); toast('Bill copy ho gaya. Paste karke share karo.', 'ok'); return; }
      setCopyText(text);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setCopyText(text);
      toast('Neeche se bill copy karke share karo.', 'info');
    }
  };
  if (dataError || bills.error || customers.error) return <main className="mx-auto max-w-md p-4"><StateView kind="error" title="Bills nahi khule" hint="Page reload karke dobara try karo." /></main>;
  if (!repo || bills.loading || customers.loading) return <main className="p-4"><StateView kind="loading" title="Bills khul rahe hain…" /></main>;
  return <main className="mx-auto max-w-md space-y-4 px-4 py-5">
    <OfflineBadge online={online} />
    <h1 className="text-2xl font-extrabold">Saved bills</h1>
    {bill ? <>
      <button className="min-h-12 rounded-xl bg-control px-4" onClick={() => { setSelected(null); setReversing(false); setCopyText(null); }}>← Wapas</button>
      <div className="receipt-stage">
        <div className="receipt-shadow">
          <article className="thermal-print-root receipt-paper" aria-label="Thermal receipt (58 mm)">
            <pre className="thermal-paper m-0 text-black">{thermal}</pre>
          </article>
        </div>
      </div>
      <div className="flex gap-2">
        <button className="min-h-12 flex-1 rounded-xl bg-lime-300 px-4 font-bold text-stone-950" onClick={() => void share()}>Share / Copy</button>
        <button className="min-h-12 flex-1 rounded-xl bg-control px-4 font-bold" onClick={() => window.print()}>Print (58 mm)</button>
      </div>
      <p className="text-sm text-muted">Print dialog mein apna 58 mm thermal printer chuno (paper size 58 mm). Share / Copy mein simple text jaata hai.</p>
      {copyText && <label className="block">Copy karke share karo<textarea readOnly value={copyText} onFocus={(e) => e.target.select()} className="min-h-48 w-full rounded-xl bg-inset p-3" /></label>}
      {bill.reversedAt === undefined && (reversing ? <ReverseDialog onCancel={() => setReversing(false)} onReverse={async (reason) => {
        const result = await repo.reverseBill(bill.id, reason);
        if (result.ok) { setReversing(false); toast('Bill reverse ho gaya.', 'ok'); }
        return result;
      }} /> : <button className="min-h-12 rounded-xl bg-control px-4 font-bold text-bad" onClick={() => setReversing(true)}>Galat bill reverse karo</button>)}
    </> : <>
      <input aria-label="Bill dhundo" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Grahak, date ya bill ID dhundo" className="min-h-12 w-full rounded-xl bg-inset px-3" />
      {filtered.length === 0 ? <StateView kind="empty" title={query ? 'Koi bill nahi mila' : 'Abhi koi saved bill nahi'} hint="Bill confirm karne ke baad yahan dikhega." /> : <ul className="divide-y divide-line rounded-xl bg-card">
        {filtered.map((b) => <li key={b.id}><button className="flex min-h-16 w-full items-center justify-between gap-3 p-4 text-left" onClick={() => setSelected(b.id)}>
          <span><span className="block font-bold">{names.get(b.customerId ?? '') ?? 'Cash bill'}</span><span className="text-sm text-muted">{formatDate(b.createdAt)}{b.reversedAt !== undefined ? ' · REVERSED' : ''}</span></span>
          <span className="num font-bold">{rupees(b.total)}</span>
        </button></li>)}
      </ul>}
    </>}
  </main>;
}
