'use client';

import { useMemo, useState } from 'react';
import { computeTotals, udhaarNeedsCustomer, hasCreditDetails, type Customer, type CatalogProduct, type DraftMessage } from '@bolbill/shared';
import type { Repo } from '@/lib/db/repo';
import { CreditDetailsForm } from '../CreditDetailsForm';
import { useApp } from '../AppProvider';
import { AdjustPanel } from './AdjustPanel';
import { Icon } from '../Icon';
import { formatQuantity, rupees } from '@/lib/format';
import { Money } from './Money';
import { removeItem, resolveCustomer, resolveItem, setAdjust, setCustomer, setItemQuantity, setPaid } from '@/lib/voice/draftEdit';

interface Props {
  draft: DraftMessage;
  products: readonly CatalogProduct[];
  customers: readonly Customer[];
  repo: Repo;
  onChange(draft: DraftMessage): void;
}

const stepFor = (unit: string) => (unit === 'kg' || unit === 'l' ? 0.5 : 1);

function Stepper({ value, step, label, onChange }: { value: number; step: number; label: string; onChange(v: number): void }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Kam karo (less)" onClick={() => onChange(Math.max(step, Math.round((value - step) * 1000) / 1000))}>−</button>
      <span className="num">{formatQuantity(value)}</span>
      <button type="button" aria-label="Zyada karo (more)" onClick={() => onChange(Math.round((value + step) * 1000) / 1000)}>+</button>
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
    <div className="note-pick" role="group" aria-label={`Item chuno: ${spoken}`}>
      <p className="font-semibold">
        &ldquo;{spoken}&rdquo; kaunsa hai?{' '}
        <span className="font-normal text-dim">{quantity !== undefined ? `${formatQuantity(quantity)} ${unit ?? ''}` : ''}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((p) => (
          <button key={p.id} type="button" className="btn-pill btn-solid" onClick={() => onPick(p)}>
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
        className="mt-2 min-h-11 w-full rounded-xl bg-card px-3 text-base"
      />
    </div>
  );
}

export function BillCard({ draft, products, customers, repo, onChange }: Props) {
  const bill = draft.bill;
  const { toast } = useApp();
  const totals = bill ? computeTotals(bill.items.reduce((sum, i) => sum + i.lineTotal, 0), bill.adjust) : null;
  const [editingCustomer, setEditingCustomer] = useState(false);
  const [customerText, setCustomerText] = useState('');

  const applyCustomer = () => {
    const name = customerText.trim();
    setEditingCustomer(false);
    if (!name) return;
    const known = customers.find((c) => c.name.toLowerCase() === name.toLowerCase());
    onChange(setCustomer(draft, known ? { id: known.id, name: known.name, isNew: false, creditReady: hasCreditDetails(known) } : { name, isNew: true, creditReady: false }));
  };

  return (
    <article className="bill" aria-label="Bill">
      <div className="bill-head">
        {editingCustomer ? (
          <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); applyCustomer(); }}>
            <input
              autoFocus
              list="customer-options"
              value={customerText}
              onChange={(e) => setCustomerText(e.target.value)}
              placeholder="Grahak ka naam"
              aria-label="Grahak ka naam"
              className="min-h-11 flex-1 rounded-xl bg-inset px-3 text-base"
            />
            <datalist id="customer-options">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            <button type="submit" className="btn-pill btn-solid">OK</button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { setCustomerText(draft.customer?.name ?? ''); setEditingCustomer(true); }}
            className="bill-cust"
            aria-label="Grahak badlo (change customer)"
          >
            <span className="av"><Icon name="user" size={18} /></span>
            <span className="lbl">{draft.customer ? draft.customer.name : 'Grahak chuno'}</span>
            {draft.customer?.isNew && <span className="bill-tag">NAYA</span>}
          </button>
        )}
        {!editingCustomer && bill && bill.items.length > 0 && <span className="bill-count">{bill.items.length} {bill.items.length === 1 ? 'item' : 'items'}</span>}
      </div>

      {bill && bill.items.length > 0 && (
        <ul className="bill-lines">
          {bill.items.map((item, i) => (
            <li key={`${draft.draftId}:${item.productId}`} className="bill-line" style={{ ['--i' as string]: i }}>
              <div className="row1">
                <p className="name">{item.name}</p>
                <p className="amt num"><Money value={item.lineTotal} /></p>
              </div>
              <div className="row2">
                <p className="rate num">{item.spokenPrice
                  ? `Bola: ${rupees(item.spokenPrice.amount)} / ${formatQuantity(item.spokenPrice.quantity)} ${item.spokenPrice.unit}${item.spokenPrice.basis === 'line' ? ' (total)' : ' (rate)'}`
                  : item.unitPrice !== null ? `${rupees(item.unitPrice)} / ${item.unit}` : 'Line price'}</p>
                <div className="flex items-center gap-1">
                  <Stepper value={item.quantity} step={stepFor(item.unit)} label={`${item.name} quantity`} onChange={(q) => onChange(setItemQuantity(draft, i, q))} />
                  <button type="button" aria-label={`${item.name} hatao (remove)`} className="bill-del" onClick={() => onChange(removeItem(draft, i))}>
                    <Icon name="trash" size={20} />
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
            <ProductPicker spoken={u.spoken} quantity={u.quantity} unit={u.unit} candidates={u.candidates} products={products} onPick={(p) => { onChange(resolveItem(draft, i, p)); void repo.learnProductAlias(p.id, u.spoken).then((learned) => { if (learned) toast(`Yaad rakh liya: ${u.spoken} = ${p.name}`, 'ok'); }); }} />
          </div>
        ) : (
          <div key={`u${i}${u.spoken}`} className="note-pick">
            <p className="font-semibold">&ldquo;{u.spoken}&rdquo; kaun sa grahak hai?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {u.candidates.map((c) => (
                <button key={c.id} type="button" className="btn-pill btn-solid" onClick={() => { onChange(resolveCustomer(draft, i, c)); void repo.learnCustomerAlias(c.id, u.spoken).then((learned) => { if (learned) toast(`Yaad rakh liya: ${u.spoken} = ${c.name}`, 'ok'); }); }}>{c.name}</button>
              ))}
            </div>
          </div>
        ),
      )}

      {bill && (
        <dl className="bill-sum num">
          {totals && bill.adjust && (
            <>
              <div className="sub"><dt>Subtotal</dt><dd>{rupees(totals.subtotal)}</dd></div>
              {totals.discount > 0 && <div className="text-good"><dt>Chhoot</dt><dd>−{rupees(totals.discount)}</dd></div>}
              {totals.gst > 0 && <div className="sub"><dt>GST {bill.adjust.gstPercent}%</dt><dd>+{rupees(totals.gst)}</dd></div>}
              {totals.roundOff !== 0 && <div className="sub"><dt>Round-off</dt><dd>{totals.roundOff > 0 ? '+' : '−'}{rupees(Math.abs(totals.roundOff))}</dd></div>}
            </>
          )}
          <div className="bill-total"><dt>Total</dt><dd><Money value={bill.total} /></dd></div>
          <div className="bill-paid">
            <dt>Abhi diye (paid)</dt>
            <dd>
              <input
                inputMode="numeric"
                aria-label="Abhi diye (paid now)"
                value={bill.paid === 0 ? '' : bill.paid}
                placeholder="0"
                onChange={(e) => onChange(setPaid(draft, Number(e.target.value.replace(/\D/g, '')) || 0))}
                className="num"
              />
            </dd>
          </div>
          <div className="bill-udhaar" data-owed={bill.udhaar > 0}><dt>{bill.udhaar > 0 ? 'Udhaar (baaki)' : 'Udhaar nahi · poora paid'}</dt><dd><Money value={bill.udhaar} /></dd></div>
        </dl>
      )}

      {bill && bill.items.length > 0 && <AdjustPanel adjust={bill.adjust} onChange={(next) => onChange(setAdjust(draft, next))} />}

      {bill && udhaarNeedsCustomer(bill.udhaar, draft.customer !== undefined) && (
        <p role="status" className="note mt-3 font-semibold" data-tone="warn">
          Udhaar ke liye upar se grahak chuno. (Pick a customer for the udhaar.)
        </p>
      )}
      {bill && bill.udhaar > 0 && !hasCreditDetails(customers.find((c) => c.id === draft.customer?.id)) && (
        <CreditDetailsForm key={draft.customer?.id ?? draft.customer?.name ?? 'new'} repo={repo}
          customer={customers.find((c) => c.id === draft.customer?.id)} name={draft.customer?.name ?? ''}
          onSaved={(c) => onChange(setCustomer(draft, { id: c.id, name: c.name, isNew: false, creditReady: true }))} />
      )}

      {draft.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-warn" role="status">
          {draft.warnings.map((w) => <li key={w} className="flex gap-2"><Icon name="alert" size={18} />{w}</li>)}
        </ul>
      )}
    </article>
  );
}
