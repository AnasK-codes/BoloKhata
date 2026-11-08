'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';

export function ReverseDialog({ onReverse, onCancel }: {
  onReverse(reason: string): Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel(): void;
}) {
  const t = useT();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await onReverse(reason);
      if (!result.ok) setError(result.error);
    } catch { setError(t('reverse.failed')); }
    finally { setBusy(false); }
  };
  return <form role="dialog" aria-label={t('reverse.label')} className="space-y-3 rounded-xl border border-red-500 p-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <p className="font-bold">{t('reverse.sure')}</p>
    <p>{t('reverse.explain')}</p>
    <label className="block">{t('reverse.reason')}<input required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-12 w-full rounded-xl bg-inset px-3" /></label>
    {error && <p role="alert" className="text-bad">{error}</p>}
    <div className="flex gap-2">
      <button disabled={busy || !reason.trim()} className="min-h-12 rounded-xl bg-bad px-4 font-bold text-on-solid disabled:opacity-50">{busy ? t('reverse.working') : t('reverse.yes')}</button>
      <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-xl bg-control px-4">{t('common.cancel')}</button>
    </div>
  </form>;
}
