'use client';

import { useState } from 'react';
import { creditDetailsSchema, type Customer } from '@bolbill/shared';
import type { Repo } from '@/lib/db/repo';
import { useT } from '@/lib/i18n';

export function CreditDetailsForm({ repo, customer, name, onSaved }: {
  repo: Repo; customer?: Customer; name: string; onSaved(customer: Customer): void;
}) {
  const t = useT();
  const [mobile, setMobile] = useState(customer?.mobile ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const parsed = creditDetailsSchema.safeParse({ name, mobile, address });
    if (!parsed.success) { setError(t('credit.invalid')); return; }
    setBusy(true);
    setError('');
    try {
      const result = await repo.saveCustomer({ ...parsed.data, aliases: customer?.aliases ?? [], ...(customer ? { id: customer.id } : {}) });
      if (result.ok) onSaved(result.customer);
      else setError(result.error);
    } catch { setError(t('credit.saveFailed')); }
    finally { setBusy(false); }
  };
  return <form className="mt-3 space-y-2 rounded-xl border border-warn p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <p className="font-bold">{t('credit.title')}</p>
    <p>{name || t('credit.pickFirst')}</p>
    <label className="block">{t('common.mobile')}<input type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value)} className="min-h-12 w-full rounded-xl bg-inset px-3" /></label>
    <label className="block">{t('common.address')}<textarea maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className="min-h-20 w-full rounded-xl bg-inset p-3" /></label>
    <p className="text-sm text-muted">{t('credit.deviceOnly')}</p>
    {error && <p role="alert" className="text-bad">{error}</p>}
    <button disabled={busy || !name} className="min-h-12 rounded-xl bg-accent px-4 font-bold text-on-solid disabled:opacity-50">{busy ? t('common.saving') : t('credit.save')}</button>
  </form>;
}
