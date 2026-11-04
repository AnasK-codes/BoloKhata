'use client';

import { useState } from 'react';
import { validateCustomerForm, type CustomerFormInput } from '@/lib/catalogForm';
import type { Repo } from '@/lib/db/repo';

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
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof CustomerFormInput, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const input = 'min-h-14 w-full rounded-xl bg-inset px-4 text-lg';

  const save = async () => {
    const result = validateCustomerForm(form);
    if (!result.ok) return setErrors(result.errors);
    const saved = await repo.saveCustomer({ ...(customerId ? { id: customerId } : {}), ...result.value });
    if (!saved.ok) return setErrors({ name: saved.error });
    onToast(customerId ? 'Badal diya' : 'Grahak jod diya', 'ok');
    onDone(true);
  };

  const remove = async () => {
    if (!customerId) return;
    const result = await repo.deleteCustomer(customerId);
    if (!result.ok) {
      setConfirmDelete(false);
      return onToast(result.error, 'error');
    }
    onToast('Grahak hata diya', 'ok');
    onDone(true);
  };

  return (
    <main className="mx-auto max-w-md px-4 py-5">
      <h1 className="mb-4 text-2xl font-extrabold">{customerId ? 'Grahak badlo' : 'Naya grahak'}</h1>
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div>
          <label htmlFor="c-name" className="font-semibold">Naam (jaise aap bolte ho)</label>
          <input id="c-name" autoFocus className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} aria-describedby="c-name-err" placeholder="Anil Singh" />
          {errors.name && <p id="c-name-err" className="mt-1 text-bad">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="c-alias" className="font-semibold">Doosre naam (comma se alag)</label>
          <input id="c-alias" className={input} value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} aria-describedby="c-alias-hint" placeholder="Anil ji, अनिल सिंह" />
          <p id="c-alias-hint" className="mt-1 text-sm text-muted">Hindi (देवनागरी) ya Hinglish, jis tarah bolte ya likhte ho. Yeh naam awaaz pehchanne mein madad karte hain.</p>
          {errors.aliases && <p className="mt-1 text-bad">{errors.aliases}</p>}
        </div>
        <div>
          <p className="text-sm text-muted">Udhaar ke liye mobile aur address dono zaroori hain. Demo mein synthetic details use karo.</p>
          <label className="block font-semibold" htmlFor="c-mobile">Mobile number</label>
          <input id="c-mobile" type="tel" inputMode="numeric" maxLength={10} className={input} value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
          {errors.mobile && <p className="text-bad">{errors.mobile}</p>}
          <label className="block font-semibold" htmlFor="c-address">Address</label>
          <textarea id="c-address" maxLength={300} className={input} value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          {errors.address && <p className="text-bad">{errors.address}</p>}
        </div>
        <div className="flex gap-2">
          <button type="submit" className="min-h-14 flex-1 rounded-xl bg-lime-300 text-lg font-bold text-stone-950">Save</button>
          <button type="button" className="min-h-14 rounded-xl bg-control px-6 text-lg font-semibold" onClick={() => onDone(false)}>Raho</button>
        </div>
        {customerId && (confirmDelete ? (
          <button type="button" className="min-h-14 w-full rounded-xl bg-red-500 text-lg font-bold text-white" onClick={() => void remove()}>Pakka hatao</button>
        ) : (
          <button type="button" className="min-h-14 w-full rounded-xl bg-raised text-lg font-semibold text-bad" onClick={() => setConfirmDelete(true)}>Grahak hatao</button>
        ))}
      </form>
    </main>
  );
}
