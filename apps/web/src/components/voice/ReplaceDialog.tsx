'use client';

import type { DraftMessage } from '@bolbill/shared';
import { rupees } from '@/lib/format';

const summary = (d: DraftMessage) =>
  d.intent === 'record_payment' ? `Payment ${rupees(d.payment?.amount ?? 0)}` : `${d.customer?.name ?? 'Bill'} · ${rupees(d.bill?.total ?? 0)}`;

/** A new bill arrived while another waits for confirmation: ask which one to keep. */
export function ReplaceDialog({ current, incoming, onAccept, onKeep }: { current: DraftMessage; incoming: DraftMessage; onAccept(): void; onKeep(): void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="replace-title">
      <div className="pop w-full max-w-md rounded-2xl bg-card p-5">
        <h2 id="replace-title" className="text-xl font-bold">Naya bill aaya. Purana hata dein?</h2>
        <p className="mt-2 text-dim">A new bill came in while one is waiting.</p>
        <p className="num mt-3">Purana: <strong>{summary(current)}</strong></p>
        <p className="num">Naya: <strong>{summary(incoming)}</strong></p>
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" className="min-h-14 rounded-xl bg-lime-300 text-lg font-bold text-stone-950" onClick={onAccept}>Naya bill lo (replace)</button>
          <button type="button" className="min-h-14 rounded-xl bg-control text-lg font-bold" onClick={onKeep}>Purana rakho (keep old)</button>
        </div>
      </div>
    </div>
  );
}
