'use client';

import type { DraftMessage } from '@bolbill/shared';
import { rupees } from '@/lib/format';
import { useT, type Translate } from '@/lib/i18n';

/** The customer's name and the amount are data; only the fallback words are translated. */
const summary = (t: Translate, d: DraftMessage) =>
  d.intent === 'record_payment' ? t('replace.payment', { amount: rupees(d.payment?.amount ?? 0) }) : `${d.customer?.name ?? t('bill.label')} · ${rupees(d.bill?.total ?? 0)}`;

/** A new bill arrived while another waits for confirmation: ask which one to keep. */
export function ReplaceDialog({ current, incoming, onAccept, onKeep }: { current: DraftMessage; incoming: DraftMessage; onAccept(): void; onKeep(): void }) {
  const t = useT();
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="replace-title">
      <div className="sheet">
        <div className="sheet-grabber" aria-hidden="true" />
        <h2 id="replace-title" className="text-xl font-bold">{t('replace.title')}</h2>
        <p className="mt-2 text-dim">{t('replace.hint')}</p>
        <dl className="num mt-4 divide-y divide-line rounded-2xl bg-inset px-4">
          <div className="flex justify-between gap-3 py-3"><dt className="text-muted">{t('replace.old')}</dt><dd className="font-semibold">{summary(t, current)}</dd></div>
          <div className="flex justify-between gap-3 py-3"><dt className="text-muted">{t('replace.new')}</dt><dd className="font-semibold">{summary(t, incoming)}</dd></div>
        </dl>
        <div className="mt-5 flex flex-col gap-2">
          <button type="button" className="btn-pill btn-solid min-h-14 text-lg" onClick={onAccept}>{t('replace.accept')}</button>
          <button type="button" className="btn-pill btn-soft min-h-14 text-lg" onClick={onKeep}>{t('replace.keep')}</button>
        </div>
      </div>
    </div>
  );
}
