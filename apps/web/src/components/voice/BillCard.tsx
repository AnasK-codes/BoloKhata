'use client';

import { useMemo, useState } from 'react';
import { udhaarNeedsCustomer, type CatalogProduct, type DraftMessage } from '@bolbill/shared';
import { Icon } from '../Icon';
import { formatQuantity, rupees } from '@/lib/format';
import { removeItem, resolveCustomer, resolveItem, setCustomer, setItemQuantity, setPaid } from '@/lib/voice/draftEdit';

interface Props {
  draft: DraftMessage;
  products: readonly CatalogProduct[];
  customers: readonly { id: string; name: string }[];
  onChange(draft: DraftMessage): void;
}

const stepFor = (unit: string) => (unit === 'kg' || unit === 'l' ? 0.5 : 1);

function Stepper({ value, step, label, onChange }: { value: number; step: number; label: string; onChange(v: number): void }) {
  const btn = 'flex h-12 w-12 items-center justify-center rounded-xl bg-control text-2xl font-bold active:bg-control';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className={btn} aria-label="Kam karo (less)" onClick={() => onChange(Math.max(step, Math.round((value - step) * 1000) / 1000))}>−</button>
      <span className="num min-w-10 text-center text-lg font-semibold">{formatQuantity(value)}</span>
      <button type="button" className={btn} aria-label="Zyada karo (more)" onClick={() => onChange(Math.round((value + step) * 1000) / 1000)}>+</button>
    </div>
  );
}

function ProductPicker({ spoken, quantity, unit, candidates, products, onPick }: { spoken: string; quantity: number | undefined; unit: string | undefined; candidates: { id: string; name: string }[]; products: readonly CatalogProduct[]; onPick(p: CatalogProduct): void }) {
  const [query, setQuery] = useState('');
  const options = useMemo(() => {
    const byId = new Map(products.map((p) => [p.id, p]));
    const picked = candidates.map((c) => byId.get(c.id)).filter((p): p is CatalogProduct => p !== undefined);
    const q = query.trim().toLowerCase();
    const found = q ? products.filter((p) => [p.name, ...p.aliases].some((n) => n.toLowerCase().includes(q))).slice(0, 6) : [];
    return q ? found : picked;
  }, [candidates, products, query]);

  return (
    <div className="rounded-xl border border-amber-500/60 bg-amber-500/10 p-3" role="group" aria-label={`Item chuno: ${spoken}`}>
      <p className="font-semibold">
        &ldquo;{spoken}&rdquo; kaunsa hai?{' '}
        <span className="font-normal text-dim">{quantity !== undefined ? `${formatQuantity(quantity)} ${unit ?? ''}` : ''}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((p) => (
          <button key={p.id} type="button" className="min-h-12 rounded-xl bg-amber-400 px-4 font-semibold text-stone-950" onClick={() => onPick(p)}>
            {p.name} · {rupees(p.pricePerUnit)}/{p.unit}
          </button>
        ))}
        {options.length === 0 && <span className="py-3 text-dim">{query ? 'Kuch nahi mila.' : 'Neeche se dhundo.'}</span>}
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Samaan dhundo (search)"
        aria-label="Samaan dhundo"
        className="mt-2 min-h-12 w-full rounded-xl bg-inset px-3 text-base"
      />
    </div>
  );
}

export function BillCard({ draft, products, customers, onChange }: Props) {
  const bill = draft.bill;
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerText, setCustomerText] = useState('');

  const applyCustomer = () => {
    const name = customerText.trim();
    setEditingCustomer(false);
    if (!name) return;
    const known = customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
    onChange(setCustomer(draft, known ? { id: known.id, name: known.name, isNew: false } : { name, isNew: true }));
  };

  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label="Bill">
      <div className="flex items-center justify-between gap-2">
        {editingCustomer ? (
          <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); applyCustomer(); }}>
            <input
              autoFocus
              list="customer-options"
              value={customerText}
              onChange={(e) => setCustomerText(e.target.value)}
              placeholder="Grahak ka naam"
              aria-label="Grahak ka naam"
              className="min-h-12 flex-1 rounded-xl bg-inset px-3 text-base"
            />
            <datalist id="customer-options">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            <button type="submit" className="min-h-12 rounded-xl bg-amber-400 px-4 font-semibold text-stone-950">OK</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { setCustomerText(draft.customer?.name ?? ''); setEditingCustomer(true); }}
            className="flex min-h-12 items-center gap-2 rounded-full bg-control px-4 text-lg font-semibold"
            aria-label="Grahak badlo (change customer)"
          >
            <Icon name="user" size={20} />
            {draft.customer ? draft.customer.name : 'Grahak chuno'}
            {draft.customer?.isNew && <span className="rounded bg-amber-400 px-1.5 text-xs font-bold text-stone-950">NAYA</span>}
          </button>
        )}
      </div>

      {bill && bill.items.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {bill.items.map((item, i) => (
            <li key={`${draft.draftId}:${item.productId}`} className="rise py-3" style={{ ['--i' as string]: i }}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-lg font-semibold">{item.name}</p>
                <p className="num text-xl font-bold">{rupees(item.lineTotal)}</p>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="num text-sm text-dim">{rupees(item.unitPrice)} / {item.unit}</p>
                <div className="flex items-center gap-2">
                  <Stepper value={item.quantity} step={stepFor(item.unit)} label={`${item.name} quantity`} onChange={(q) => onChange(setItemQuantity(draft, i, q))} />
                  <button type="button" aria-label={`${item.name} hatao (remove)`} className="flex h-12 w-12 items-center justify-center rounded-xl text-bad active:bg-control" onClick={() => onChange(removeItem(draft, i))}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z" /></svg>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft.unresolved.map((u, i) =>
        u.kind === 'item' ? (
          <div key={`u${i}${u.spoken}`} className="mt-3">
            <ProductPicker spoken={u.spoken} quantity={u.quantity} unit={u.unit} candidates={u.candidates} products={products} onPick={(p) => onChange(resolveItem(draft, i, p))} />
          </div>
        ) : (
          <div key={`u${i}${u.spoken}`} className="mt-3 rounded-xl border border-amber-500/60 bg-amber-500/10 p-3">
            <p className="font-semibold">&ldquo;{u.spoken}&rdquo; kaun sa grahak hai?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {u.candidates.map((c) => (
                <button key={c.id} type="button" className="min-h-12 rounded-xl bg-amber-400 px-4 font-semibold text-stone-950" onClick={() => onChange(resolveCustomer(draft, i, c))}>{c.name}</button>
              ))}
            </div>
          </div>
        ),
      )}

      {bill && (
        <dl className="num mt-3 space-y-1 border-t border-line pt-3 text-lg">
          <div className="flex justify-between text-2xl font-extrabold"><dt>Total</dt><dd>{rupees(bill.total)}</dd></div>
          <div className="flex items-center justify-between">
            <dt>Abhi diye (paid)</dt>
            <dd>
              <input
                inputMode="numeric"
                aria-label="Abhi diye (paid now)"
                value={bill.paid === 0 ? '' : bill.paid}
                placeholder="0"
                onChange={(e) => onChange(setPaid(draft, Number(e.target.value.replace(/\D/g, '')) || 0))}
                className="num min-h-12 w-28 rounded-xl bg-inset px-3 text-right text-lg"
              />
            </dd>
          </div>
          <div className={`flex justify-between font-bold ${bill.udhaar > 0 ? 'text-warn' : 'text-good'}`}><dt>Udhaar</dt><dd>{rupees(bill.udhaar)}</dd></div>
        </dl>
      )}

      {bill && udhaarNeedsCustomer(bill.udhaar, draft.customer !== undefined) && (
        <p role="status" className="mt-3 rounded-xl bg-amber-400/15 px-3 py-2 font-semibold text-warn">
          Udhaar ke liye upar se grahak chuno. (Pick a customer for the udhaar.)
        </p>
      )}

      {draft.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-warn" role="status">
          {draft.warnings.map((w) => <li key={w} className="flex gap-2"><Icon name="alert" size={18} />{w}</li>)}
        </ul>
      )}
    </article>
  );
}
