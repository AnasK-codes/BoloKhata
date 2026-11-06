'use client';

import { useMemo, useState } from 'react';
import { LOW_STOCK_AT, UNITS, isLowStock, isOutOfStock, type Product } from '@bolbill/shared';
import { rupees } from '@/lib/format';
import { useLive } from '@/lib/db/live';
import { validateProductForm, type ProductFormInput } from '@/lib/catalogForm';
import { useOnline } from '@/lib/useOnline';
import { useApp } from './AppProvider';
import { OfflineBadge, StateView } from './StateView';

const EMPTY: ProductFormInput = { name: '', price: '', unit: 'kg', aliases: '', stock: '' };

export function CatalogScreen() {
  const { repo, dataError, toast } = useApp();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id?: string; form: ProductFormInput } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormInput, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [onlyLow, setOnlyLow] = useState(false);

  const products = useLive(repo ? () => repo.listProducts() : null, [repo]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (products.data ?? []).filter((p) => (!onlyLow || isLowStock(p) || isOutOfStock(p)) && (!q || [p.name, ...p.aliases].some((n) => n.toLowerCase().includes(q))));
  }, [products.data, query, onlyLow]);
  const outCount = (products.data ?? []).filter(isOutOfStock).length;
  const lowCount = (products.data ?? []).filter(isLowStock).length;

  if (dataError) return <main className="mx-auto max-w-md px-4 py-6"><StateView kind="error" title="Data nahi khul paya" hint={dataError} /></main>;

  const open = (p?: Product) => {
    setErrors({});
    setEditing(p ? { id: p.id, form: { name: p.name, price: String(p.pricePerUnit), unit: p.unit, aliases: p.aliases.join(', '), stock: p.stock === undefined ? '' : String(p.stock) } } : { form: EMPTY });
  };

  const save = async () => {
    if (!editing || !repo) return;
    const result = validateProductForm(editing.form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const existing = (products.data ?? []).find((p) => p.id === editing.id);
    // `stock` is replaced, not merged: clearing the field stops tracking the product.
    const { stock: _previousStock, ...kept } = existing ?? ({} as Partial<Product>);
    await repo.upsertProduct({ ...kept, ...(editing.id ? { id: editing.id } : {}), ...result.value });
    toast(editing.id ? 'Badal diya' : 'Samaan jod diya', 'ok');
    setEditing(null);
  };

  const field = (key: keyof ProductFormInput) => (e: { target: { value: string } }) =>
    setEditing((s) => (s ? { ...s, form: { ...s.form, [key]: e.target.value } } : s));
  const input = 'min-h-14 w-full rounded-xl bg-inset px-4 text-lg';

  if (editing) {
    return (
      <main className="mx-auto max-w-md px-4 py-5">
        <h1 className="mb-4 text-2xl font-extrabold">{editing.id ? 'Samaan badlo' : 'Naya samaan'}</h1>
        <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div>
            <label htmlFor="p-name" className="font-semibold">Naam</label>
            <input id="p-name" className={input} value={editing.form.name} onChange={field('name')} aria-invalid={!!errors.name} aria-describedby="e-name" />
            {errors.name && <p id="e-name" className="mt-1 text-bad">{errors.name}</p>}
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="p-price" className="font-semibold">Rate (₹)</label>
              <input id="p-price" inputMode="numeric" className={`${input} num`} value={editing.form.price} onChange={field('price')} aria-invalid={!!errors.price} aria-describedby="e-price" />
            </div>
            <div className="w-32">
              <label htmlFor="p-unit" className="font-semibold">Unit</label>
              <select id="p-unit" className={input} value={editing.form.unit} onChange={field('unit')}>
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {errors.price && <p id="e-price" className="-mt-2 text-bad">{errors.price}</p>}
          <div>
            <label htmlFor="p-alias" className="font-semibold">Doosre naam (comma se alag)</label>
            <input id="p-alias" className={input} value={editing.form.aliases} onChange={field('aliases')} placeholder="atta, gehu ka aata" aria-describedby="e-alias" />
            {errors.aliases && <p id="e-alias" className="mt-1 text-bad">{errors.aliases}</p>}
          </div>
          <div>
            <label htmlFor="p-stock" className="font-semibold">Stock (kitna bacha hai, optional)</label>
            <input id="p-stock" inputMode="decimal" className={`${input} num`} value={editing.form.stock ?? ''} onChange={field('stock')} placeholder="khali = ginti nahi" aria-invalid={!!errors.stock} aria-describedby="e-stock" />
            {errors.stock && <p id="e-stock" className="mt-1 text-bad">{errors.stock}</p>}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="min-h-14 flex-1 rounded-xl bg-accent text-lg font-bold text-on-solid">Save</button>
            <button type="button" className="min-h-14 rounded-xl bg-control px-6 text-lg font-semibold" onClick={() => setEditing(null)}>Raho</button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-5">
      <OfflineBadge online={online} />
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold">Samaan</h1>
        <button type="button" onClick={() => open()} className="min-h-12 rounded-xl bg-accent px-5 font-bold text-on-solid">+ Naya</button>
      </header>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Samaan dhundo (search)" aria-label="Samaan dhundo" className={input} />
      {(outCount > 0 || lowCount > 0 || onlyLow) && (
        <div className="stock-filter" role="group" aria-label="Stock filter">
          <button type="button" className="chip" aria-pressed={!onlyLow} onClick={() => setOnlyLow(false)}>Sab</button>
          <button type="button" className="chip" aria-pressed={onlyLow} onClick={() => setOnlyLow(true)}>
            Kam / khatam{outCount + lowCount > 0 ? ` (${outCount + lowCount})` : ''}
          </button>
        </div>
      )}
      {products.loading || !repo ? (
        <StateView kind="loading" title="Samaan khul raha hai" />
      ) : products.error ? (
        <StateView kind="error" title="Samaan nahi khul paya" hint="Page reload karke dekho." />
      ) : shown.length === 0 ? (
        <StateView kind="empty" title={query ? 'Kuch nahi mila' : 'Abhi koi samaan nahi'} hint={query ? 'Doosra naam try karo.' : 'Bill banane ke liye pehle samaan jodo. Ya bolo poori list: "Samaan mein aata 45, cheeni 50, chawal 60 add karo".'}>
          {!query && <button type="button" onClick={() => open()} className="min-h-12 rounded-xl bg-accent px-5 font-bold text-on-solid">+ Samaan jodo</button>}
        </StateView>
      ) : (
        <ul className="divide-y divide-line rounded-2xl bg-card">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-4 py-2">
              <button type="button" onClick={() => open(p)} className="min-h-14 flex-1 text-left" aria-label={`${p.name} badlo`}>
                <span className="block text-lg font-semibold">{p.name}</span>
                {p.aliases.length > 0 && <span className="block truncate text-sm text-muted">{p.aliases.join(', ')}</span>}
                {isOutOfStock(p) && <span className="badge badge-bad mt-1">Khatam</span>}
                {isLowStock(p) && <span className="badge badge-warn mt-1">Kam stock: {p.stock} {p.unit}</span>}
                {p.stock !== undefined && p.stock > LOW_STOCK_AT && <span className="mt-0.5 block text-sm text-muted">Stock: {p.stock} {p.unit}</span>}
              </button>
              <span className="num whitespace-nowrap text-lg font-bold">{rupees(p.pricePerUnit)}<span className="text-sm font-normal text-muted">/{p.unit}</span></span>
              {confirmDelete === p.id ? (
                <button type="button" className="min-h-12 rounded-xl bg-bad px-3 font-bold text-on-solid" onClick={() => { void repo?.deleteProduct(p.id); setConfirmDelete(null); }}>Pakka hatao</button>
              ) : (
                <button type="button" aria-label={`${p.name} hatao`} className="flex h-12 w-12 items-center justify-center rounded-xl text-bad active:bg-raised" onClick={() => setConfirmDelete(p.id)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z" /></svg>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
