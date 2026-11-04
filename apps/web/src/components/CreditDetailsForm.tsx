'use client';

import { useState } from 'react';
import { creditDetailsSchema, type Customer } from '@bolbill/shared';
import type { Repo } from '@/lib/db/repo';

export function CreditDetailsForm({ repo, customer, name, onSaved }: {
  repo: Repo; customer?: Customer; name: string; onSaved(customer: Customer): void;
}) {
  const [mobile, setMobile] = useState(customer?.mobile ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const parsed = creditDetailsSchema.safeParse({ name, mobile, address });
    if (!parsed.success) { setError('Naam, 10 digit mobile aur poora address (kam se kam 5 letters) bharo.'); return; }
    setBusy(true);
    setError('');
    try {
      const result = await repo.saveCustomer({ ...parsed.data, aliases: customer?.aliases ?? [], ...(customer ? { id: customer.id } : {}) });
      if (result.ok) onSaved(result.customer);
      else setError(result.error);
    } catch { setError('Details save nahi hui. Dobara try karo.'); }
    finally { setBusy(false); }
  };
  return <form className="mt-3 space-y-2 rounded-xl border border-amber-500 p-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
    <p className="font-bold">Udhaar ke liye grahak ki details zaroori hain</p>
    <p>{name || 'Pehle upar grahak ka naam chuno.'}</p>
    <label className="block">Mobile number<input aria-label="Mobile number" type="tel" inputMode="numeric" maxLength={10} value={mobile} onChange={(e) => setMobile(e.target.value)} className="min-h-12 w-full rounded-xl bg-inset px-3" /></label>
    <label className="block">Address<textarea aria-label="Address" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} className="min-h-20 w-full rounded-xl bg-inset p-3" /></label>
    <p className="text-sm text-muted">Details sirf is device par save hoti hain. Demo mein synthetic details use karo.</p>
    {error && <p role="alert" className="text-bad">{error}</p>}
    <button disabled={busy || !name} className="min-h-12 rounded-xl bg-amber-400 px-4 font-bold text-stone-950 disabled:opacity-50">{busy ? 'Save ho raha hai…' : 'Details save karo'}</button>
  </form>;
}
