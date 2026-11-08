'use client';

import { useState } from 'react';
import { validateCustomerForm, type CustomerFormInput } from '@/lib/catalogForm';
import type { Repo } from '@/lib/db/repo';
import { useT } from '@/lib/i18n';

interface Props {
  repo: Repo;
  /** Present when editing. */
  customerId?: string;
  initial: CustomerFormInput;
  onDone(saved: boolean): void;
  onToast(message: string, kind: 'ok' | 'error'): void;
}

/** Add or edit a customer: the name as you say it, plus other ways it may be said or written. */
export function CustomerForm({ repo, customerId, initial, onDone, onToast }: Props) {
  const t = useT();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerFormInput, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = 'min-h-14 w-full rounded-xl bg-inset px-4 text-lg';

  const save = async () => {
    const result = validateCustomerForm(form);
    if (!result.ok) return setErrors(result.errors);
    const saved = await repo.saveCustomer({ ...(customerId ? { id: customerId } : {}), ...result.value });
    if (!saved.ok) return setErrors({ name: saved.error });
    onToast(customerId ? t('common.updated') : t('customer.added'), 'ok');
    onDone(true);
  };

  const remove = async () => {
    if (!customerId) return;
    const result = await repo.deleteCustomer(customerId);
    if (!result.ok) {
      setConfirmDelete(false);
      return onToast(result.error, 'error');
    }
    onToast(t('customer.removed'), 'ok');
    onDone(true);
  };

  return (
    <main className="mx-auto max-w-md px-4 py-5">
      <h1 className="mb-4 text-2xl font-extrabold">{customerId ? t('customer.editTitle') : t('customer.newTitle')}</h1>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div>
          <label htmlFor="c-name" className="font-semibold">{t('customer.nameLabel')}</label>
          <input id="c-name" autoFocus className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} aria-describedby="c-name-err" placeholder={t('customer.namePlaceholder')} />
          {errors.name && <p id="c-name-err" className="mt-1 text-bad">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="c-alias" className="font-semibold">{t('common.aliases')}</label>
          <input id="c-alias" className={input} value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} aria-describedby="c-alias-hint" placeholder={t('customer.aliasPlaceholder')} />
          <p id="c-alias-hint" className="mt-1 text-sm text-muted">{t('customer.aliasHint')}</p>
          {errors.aliases && <p className="mt-1 text-bad">{errors.aliases}</p>}
        </div>
        <div>
          <p className="text-sm text-muted">{t('customer.creditNote')}</p>
          <label className="block font-semibold" htmlFor="c-mobile">{t('common.mobile')}</label>
          <input id="c-mobile" type="tel" inputMode="numeric" maxLength={10} className={input} value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          {errors.mobile && <p className="text-bad">{errors.mobile}</p>}
          <label className="block font-semibold" htmlFor="c-address">{t('common.address')}</label>
          <textarea id="c-address" maxLength={300} className={input} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          {errors.address && <p className="text-bad">{errors.address}</p>}
        </div>
        <div className="flex gap-2">
          <button type="submit" className="min-h-14 flex-1 rounded-xl bg-accent text-lg font-bold text-on-solid">{t('common.save')}</button>
          <button type="button" className="min-h-14 rounded-xl bg-control px-6 text-lg font-semibold" onClick={() => onDone(false)}>{t('common.cancel')}</button>
        </div>
        {customerId && (confirmDelete ? (
          <button type="button" className="min-h-14 w-full rounded-xl bg-bad text-lg font-bold text-on-solid" onClick={() => void remove()}>{t('common.confirmDelete')}</button>
        ) : (
          <button type="button" className="min-h-14 w-full rounded-xl bg-raised text-lg font-semibold text-bad" onClick={() => setConfirmDelete(true)}>{t('customer.remove')}</button>
        ))}
      </form>
    </main>
  );
}
