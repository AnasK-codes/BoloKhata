'use client';

import { useState } from 'react';
import { businessProfileSchema, type BusinessProfile } from '@bolbill/shared';
import { useT } from '@/lib/i18n';

export function BusinessProfileForm({ initial, onSave, onCancel }: {
  initial?: BusinessProfile;
  onSave(profile: BusinessProfile): Promise<void>;
  onCancel?: () => void;
}) {
  const t = useT();
  const [form, setForm] = useState({ businessName: initial?.businessName ?? '', ownerName: initial?.ownerName ?? '',
    address: initial?.address ?? '', mobile: initial?.mobile ?? '', receiptFooter: initial?.receiptFooter ?? t('profile.defaultFooter') });
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
        next[key] = key === 'mobile' ? t('form.mobileInvalid') : key === 'address' ? t('form.addressInvalid') : t('profile.invalidField');
      }
      setErrors(next);
      return;
    }
    setBusy(true); setError(''); setErrors({});
    try { await onSave(parsed.data); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('profile.saveFailed')); }
    finally { setBusy(false); }
  };
  const fields = [
    ['businessName', t('profile.businessName'), 100], ['ownerName', t('profile.ownerName'), 80],
    ['mobile', t('profile.mobile'), 10], ['address', t('profile.address'), 300], ['receiptFooter', t('profile.footer'), 160],
  ] as const;
  return <main className="mx-auto max-w-md space-y-5 px-4 py-6">
    <header><h1 className="text-2xl font-extrabold">{initial ? t('profile.editTitle') : t('profile.createTitle')}</h1>
      <p className="mt-2 text-dim">{t('profile.intro')}</p></header>
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {fields.map(([key, label, max]) => <label key={key} className="block font-semibold" htmlFor={`business-${key}`}>{label}
        {key === 'address' || key === 'receiptFooter' ?
          <textarea id={`business-${key}`} maxLength={max} value={form[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!errors[key]} className="mt-1 min-h-20 w-full rounded-xl bg-inset p-3 text-base" /> :
          <input id={`business-${key}`} type={key === 'mobile' ? 'tel' : 'text'} maxLength={max} value={form[key]} onChange={(e) => change(key, e.target.value)} aria-invalid={!!errors[key]} className="mt-1 min-h-12 w-full rounded-xl bg-inset px-3 text-base" />}
        {errors[key] && <span className="text-sm text-bad">{errors[key]}</span>}
      </label>)}
      <section className="space-y-2 rounded-xl border border-line p-4" aria-label={t('profile.preview')}>
        <p className="text-sm text-muted">{t('profile.previewNote')}</p>
        <p className="break-words text-xl font-bold">{form.businessName || t('profile.yourShop')}</p>
        <p className="whitespace-pre-wrap break-words">{form.address || t('profile.address')}</p>
        <p>{form.mobile || t('profile.mobileShort')}</p>
        <hr className="border-line" /><p className="flex justify-between"><span>{t('profile.sampleItem')}</span><span>₹10</span></p>
        <p className="flex justify-between font-bold"><span>{t('voice.total')}</span><span>₹10</span></p>
        <hr className="border-line" /><p className="whitespace-pre-wrap break-words text-center">{form.receiptFooter}</p>
      </section>
      {error && <p role="alert" className="text-bad">{error}</p>}
      <button disabled={busy} className="min-h-14 w-full rounded-xl bg-accent px-4 text-lg font-bold text-on-solid disabled:opacity-50">{busy ? t('common.saving') : t('profile.save')}</button>
      {onCancel && <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 w-full rounded-xl bg-control px-4">{t('common.back')}</button>}
    </form>
  </main>;
}
