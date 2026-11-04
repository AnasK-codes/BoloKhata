'use client';

import { useState } from 'react';
import { businessProfileSchema, type BusinessProfile } from '@bolbill/shared';

export function BusinessProfileForm({ initial, onSave, onCancel }: {
  initial?: BusinessProfile;
  onSave(profile: BusinessProfile): Promise<void>;
  onCancel?: () => void;
}) {
  const [form, setForm] = useState({ businessName: initial?.businessName ?? '', ownerName: initial?.ownerName ?? '',
    address: initial?.address ?? '', mobile: initial?.mobile ?? '', receiptFooter: initial?.receiptFooter ?? 'Dhanyavaad! Phir aaiye.' });
  const [errors, setErrors] = useState<Partial<Record<keyof BusinessProfile, string>>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = (key: keyof BusinessProfile, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
    setError('');
  };
  const save = async () => {
    const parsed = businessProfileSchema.safeParse(form);
    if (!parsed.success) {
      const next: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof BusinessProfile;
        next[key] = key === 'mobile' ? '10 digit mobile number likho.' : key === 'address' ? 'Poora address likho (5–300 letters).' : 'Yeh detail sahi bharo.';
      }
      setErrors(next);
      return;
    }
    setBusy(true); setError(''); setErrors({});
    try { await onSave(parsed.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Profile save nahi hui. Dobara try karo.'); }
    finally { setBusy(false); }
  };
  const fields = [
    ['businessName', 'Business / dukaan ka naam', 100], ['ownerName', 'Owner ka naam', 80],
    ['mobile', 'Business mobile number', 10], ['address', 'Business address', 300], ['receiptFooter', 'Bill ke neeche ka message', 160],
  ] as const;
  return <main className="mx-auto max-w-md space-y-5 px-4 py-6">
    <header><h1 className="text-2xl font-extrabold">{initial ? 'Business profile aur bill' : 'Pehle business profile banao'}</h1>
      <p className="mt-2 text-dim">Dukaan ki details receipt par aayengi. Profile save karne ke baad billing shuru hogi.</p></header>
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {fields.map(([key, label, max]) => <label key={key} className="block font-semibold" htmlFor={`business-${key}`}>{label}
        {key === 'address' || key === 'receiptFooter' ?
          <textarea id={`business-${key}`} maxLength={max} value={form[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!errors[key]} className="mt-1 min-h-20 w-full rounded-xl bg-inset p-3 text-base" /> :
          <input id={`business-${key}`} type={key === 'mobile' ? 'tel' : 'text'} maxLength={max} value={form[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!errors[key]} className="mt-1 min-h-12 w-full rounded-xl bg-inset px-3 text-base" />}
        {errors[key] && <span className="text-sm text-bad">{errors[key]}</span>}
      </label>)}
      <section className="space-y-2 rounded-xl border border-line p-4" aria-label="Receipt template preview">
        <p className="text-sm text-muted">Bill template preview — sample item</p>
        <p className="break-words text-xl font-bold">{form.businessName || 'Aapki dukaan'}</p>
        <p className="whitespace-pre-wrap break-words">{form.address || 'Business address'}</p>
        <p>{form.mobile || 'Business mobile'}</p>
        <hr className="border-line" /><p className="flex justify-between"><span>Sample item × 1</span><span>₹10</span></p>
        <p className="flex justify-between font-bold"><span>Total</span><span>₹10</span></p>
        <hr className="border-line" /><p className="whitespace-pre-wrap break-words text-center">{form.receiptFooter}</p>
      </section>
      {error && <p role="alert" className="text-bad">{error}</p>}
      <button disabled={busy} className="min-h-14 w-full rounded-xl bg-lime-300 px-4 text-lg font-bold text-stone-950 disabled:opacity-50">{busy ? 'Save ho raha hai…' : 'Profile aur template save karo'}</button>
      {onCancel && <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 w-full rounded-xl bg-control px-4">Wapas</button>}
    </form>
  </main>;
}
