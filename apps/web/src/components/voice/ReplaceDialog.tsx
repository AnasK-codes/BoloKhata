'use client';

import type { DraftMessage } from '@bolbill/shared';
import { rupees } from '@/lib/format';

const summary = (d: DraftMessage) =>
  d.intent === 'record_payment' ? `Payment ${rupees(d.payment?.amount ?? 0)}` : `${d.customer?.name ?? 'Bill'} · ${rupees(d.bill?.total ?? 0)}`;

/** A new bill arrived while another waits for confirmation: ask which one to keep. */
export function ReplaceDialog({ current, incoming, onAccept, onKeep }: { current: DraftMessage; incoming: DraftMessage; onAccept(): void; onKeep(): void }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="replace-title">
      <div className="sheet">
        <div className="sheet-grabber" aria-hidden="true" />
        <h2 id="replace-title" className="text-xl font-bold">Naya bill aaya. Purana hata dein?</h2>
        <p className="mt-2 text-dim">A new bill came in while one is waiting.</p>
        <dl className="num mt-4 divide-y divide-line rounded-2xl bg-inset px-4">
          <div className="flex justify-between gap-3 py-3"><dt className="text-muted">Purana</dt><dd className="font-semibold">{summary(current)}</dd></div>
          <div className="flex justify-between gap-3 py-3"><dt className="text-muted">Naya</dt><dd className="font-semibold">{summary(incoming)}</dd></div>
        </dl>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="btn-pill btn-solid min-h-14 text-lg" onClick={onAccept}>Naya bill lo (replace)</button>
          <button type="button" className="btn-pill btn-soft min-h-14 text-lg" onClick={onKeep}>Purana rakho (keep old)</button>
        </div>
      </div>
    </div>
  );
}
