'use client';

import { useState } from 'react';

export function ReverseDialog({ onReverse, onCancel }: {
  onReverse(reason: string): Promise<{ ok: true } | { ok: false; error: string }>;
  onCancel(): void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await onReverse(reason);
      if (!result.ok) setError(result.error);
    } catch { setError('Reverse nahi hua. Dobara try karo.'); }
    finally { setBusy(false); }
  };
  return <form role="dialog" aria-label="Entry reverse karo" className="space-y-3 rounded-xl border border-red-500 p-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
    <p className="font-bold">Pakka reverse karna hai?</p>
    <p>Original record rahega; linked reversal se khata theek hoga. Cash refund apne aap nahi hota.</p>
    <label className="block">Wajah<input required maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-12 w-full rounded-xl bg-inset px-3" /></label>
    {error && <p role="alert" className="text-bad">{error}</p>}
    <div className="flex gap-2">
      <button disabled={busy || !reason.trim()} className="min-h-12 rounded-xl bg-bad px-4 font-bold text-on-solid disabled:opacity-50">{busy ? 'Ho raha hai…' : 'Haan, reverse karo'}</button>
      <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-xl bg-control px-4">Raho</button>
    </div>
  </form>;
}
