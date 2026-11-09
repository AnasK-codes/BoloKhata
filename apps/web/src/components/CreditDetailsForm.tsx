'use client';

import { useRef, useState } from 'react';
import { creditDetailsSchema, type Customer } from '@bolbill/shared';
import type { Repo } from '@/lib/db/repo';
import { detailErrors, type DetailErrors } from '@/lib/detailIssues';
import { useT } from '@/lib/i18n';

type Field = keyof DetailErrors;

/**
 * Mobile and address for a customer who owes udhaar. Each wrong field says what is wrong and how to
 * fix it, right under it. Errors show once a field has been left or the form was sent, and then
 * update as you type, so they go away the moment the value is right.
 */
export function CreditDetailsForm({ repo, customer, name, onSaved }: {
  repo: Repo; customer?: Customer; name: string; onSaved(customer: Customer): void;
}) {
  const t = useT();
  const [mobile, setMobile] = useState(customer?.mobile ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const mobileRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLTextAreaElement>(null);

  const errors = detailErrors(t, { name, mobile, address });
  const shown = (field: Field): string | undefined => (submitted || touched[field] ? errors[field] : undefined);
  const touch = (field: Field) => () => setTouched((s) => ({ ...s, [field]: true }));

  const save = async () => {
    setSubmitted(true);
    setServerError('');
    if (Object.keys(errors).length > 0) {
      // Take the user to the first thing to fix.
      (errors.mobile ? mobileRef : addressRef).current?.focus();
      return;
    }
    const parsed = creditDetailsSchema.safeParse({ name, mobile, address });
    if (!parsed.success) { setServerError(t('credit.invalid')); return; }
    setBusy(true);
    try {
      const result = await repo.saveCustomer({ ...parsed.data, aliases: customer?.aliases ?? [], ...(customer ? { id: customer.id } : {}) });
      if (result.ok) onSaved(result.customer);
      else setServerError(result.error);
    } catch { setServerError(t('credit.saveFailed')); }
    finally { setBusy(false); }
  };

  const field = 'min-h-12 w-full rounded-xl bg-inset px-3';
  const bad = 'ring-2 ring-bad';
  const mobileError = shown('mobile');
  const addressError = shown('address');
  const nameError = submitted ? errors.name : undefined;
  const digits = mobile.trim().length;

  return <form className="mt-3 space-y-3 rounded-xl border border-warn p-3" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <p className="font-bold">{t('credit.title')}</p>
    <p>{name || t('credit.pickFirst')}</p>
    {nameError && <p role="alert" className="text-bad">{nameError}</p>}
    <div>
      <label htmlFor="credit-mobile" className="flex items-baseline justify-between gap-2">
        <span>{t('common.mobile')}</span>
        <span className={`num text-sm ${digits > 10 ? 'text-bad' : 'text-muted'}`} aria-hidden="true">{t('credit.digitsCount', { count: digits })}</span>
      </label>
      <input id="credit-mobile" ref={mobileRef} type="tel" inputMode="numeric" autoComplete="tel-national" value={mobile}
        onChange={(e) => setMobile(e.target.value)} onBlur={touch('mobile')}
        aria-invalid={mobileError !== undefined} aria-describedby={mobileError ? 'credit-mobile-error' : 'credit-mobile-hint'}
        className={`${field} num ${mobileError ? bad : ''}`} />
      {mobileError
        ? <p id="credit-mobile-error" role="alert" className="mt-1 flex gap-1 text-bad"><span aria-hidden="true">✕</span>{mobileError}</p>
        : <p id="credit-mobile-hint" className="mt-1 text-sm text-muted">{t('credit.mobileHint')}</p>}
    </div>
    <div>
      <label htmlFor="credit-address">{t('common.address')}</label>
      <textarea id="credit-address" ref={addressRef} maxLength={300} value={address} autoComplete="street-address"
        onChange={(e) => setAddress(e.target.value)} onBlur={touch('address')}
        aria-invalid={addressError !== undefined} aria-describedby={addressError ? 'credit-address-error' : 'credit-address-hint'}
        className={`min-h-20 w-full rounded-xl bg-inset p-3 ${addressError ? bad : ''}`} />
      {addressError
        ? <p id="credit-address-error" role="alert" className="mt-1 flex gap-1 text-bad"><span aria-hidden="true">✕</span>{addressError}</p>
        : <p id="credit-address-hint" className="mt-1 text-sm text-muted">{t('credit.addressHint')}</p>}
    </div>
    <p className="text-sm text-muted">{t('credit.deviceOnly')}</p>
    {submitted && Object.keys(errors).length > 0 && <p role="alert" className="font-semibold text-bad">{t('credit.fixFields')}</p>}
    {serverError && <p role="alert" className="text-bad">{serverError}</p>}
    <button disabled={busy} className="min-h-12 rounded-xl bg-accent px-4 font-bold text-on-solid disabled:opacity-50">{busy ? t('common.saving') : t('credit.save')}</button>
  </form>;
}
