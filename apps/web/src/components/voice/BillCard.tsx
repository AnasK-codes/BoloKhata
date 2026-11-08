'use client';

import { useMemo, useState } from 'react';
import { computeTotals, udhaarNeedsCustomer, hasCreditDetails, type Customer, type CatalogProduct, type DraftMessage } from '@bolbill/shared';
import type { Repo } from '@/lib/db/repo';
import { CreditDetailsForm } from '../CreditDetailsForm';
import { useApp } from '../AppProvider';
import { AdjustPanel } from './AdjustPanel';
import { Icon } from '../Icon';
import { formatQuantity, rupees } from '@/lib/format';
import { answerMissingItem, dismissQuestion, quantityChoices, removeItem, resolveCustomer, resolveItem, setAdjust, setCustomer, setItemQuantity, setPaid } from '@/lib/voice/draftEdit';

interface Props {
  draft: DraftMessage;
  products: readonly CatalogProduct[];
  customers: readonly Customer[];
  repo: Repo;
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
    <div className="rounded-xl border border-warn/60 bg-warn/10 p-3" role="group" aria-label={`Item chuno: ${spoken}`}>
      <p className="font-semibold">
        &ldquo;{spoken}&rdquo; kaunsa hai?{' '}
        <span className="font-normal text-dim">{quantity !== undefined ? `${formatQuantity(quantity)} ${unit ?? ''}` : ''}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((p) => (
          <button key={p.id} type="button" className="min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-solid" onClick={() => onPick(p)}>
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

/** Shown after the voice has asked twice: the rest is done by tapping, never a third spoken question. */
function FallbackNote() {
  return (
    <p role="status" className="mb-3 flex gap-2 rounded-xl bg-warn/15 px-3 py-2 font-semibold text-warn">
      <Icon name="alert" size={18} />
      Yahan tap karke chuniye. (Tap to pick; no need to say it again.)
    </p>
  );
}

/** "kitna chahiye?" as taps, under the line in question. */
function QuantityChips({ unit, onPick, onDrop }: { unit: string; onPick(q: number): void; onDrop(): void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Kitna chahiye? (How much?)">
      {quantityChoices(unit as Parameters<typeof quantityChoices>[0]).map((q) => (
        <button key={q} type="button" className="min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-solid" onClick={() => onPick(q)}>{formatQuantity(q)} {unit}</button>
      ))}
      <button type="button" className="min-h-12 rounded-xl bg-control px-4 font-semibold" onClick={onDrop}>Hatao</button>
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

  const ask = draft.clarification;
  const askLine = ask?.slot === 'quantity' ? ask.itemIndex : undefined;
  const askSpoken = ask?.slot === 'item' ? ask.spoken : undefined;

  return (
    <article className="pop rounded-2xl bg-card p-4" aria-label="Bill">
      {ask?.fallback && <FallbackNote />}
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
            <button type="submit" className="min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-solid">OK</button>
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
            {draft.customer?.isNew && <span className="rounded bg-accent px-1.5 text-xs font-bold text-on-solid">NAYA</span>}
          </button>
        )}
      </div>

      {bill && bill.items.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {bill.items.map((item, i) => (
            <li key={`${draft.draftId}:${item.productId}`} className={`rise py-3${askLine === i ? ' rounded-xl ring-2 ring-warn' : ''}`} style={{ ['--i' as string]: i }} {...(askLine === i ? { 'aria-current': 'step' as const } : {})}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-lg font-semibold">{item.name}</p>
                <p className="num text-xl font-bold">{rupees(item.lineTotal)}</p>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="num text-sm text-dim">{item.spokenPrice
                  ? `Bola: ${rupees(item.spokenPrice.amount)} / ${formatQuantity(item.spokenPrice.quantity)} ${item.spokenPrice.unit}${item.spokenPrice.basis === 'line' ? ' (total)' : ' (rate)'}`
                  : item.unitPrice !== null ? `${rupees(item.unitPrice)} / ${item.unit}` : 'Line price'}</p>
                <div className="flex items-center gap-2">
                  <Stepper value={item.quantity} step={stepFor(item.unit)} label={`${item.name} quantity`} onChange={(q) => onChange(setItemQuantity(draft, i, q))} />
                  <button type="button" aria-label={`${item.name} hatao (remove)`} className="flex h-12 w-12 items-center justify-center rounded-xl text-bad active:bg-control" onClick={() => onChange(removeItem(draft, i))}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z" /></svg>
                  </button>
                </div>
              </div>
              {askLine === i && (
                <>
                  <p className="mt-2 font-semibold text-warn">{item.name} kitna chahiye?</p>
                  <QuantityChips unit={item.unit} onPick={(q) => onChange(setItemQuantity(draft, i, q))} onDrop={() => onChange(dismissQuestion(draft))} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {ask?.slot === 'item' && ask.spoken === undefined && (
        <div className="mt-3 rounded-xl ring-2 ring-warn" aria-current="step">
          <ProductPicker spoken={ask.quantity !== undefined ? `${formatQuantity(ask.quantity)} ${ask.unit ?? ''}`.trim() : '?'} quantity={undefined} unit={undefined} candidates={[]} products={products} onPick={(p) => onChange(answerMissingItem(draft, p))} />
          <button type="button" className="m-3 mt-0 min-h-12 rounded-xl bg-control px-4 font-semibold" onClick={() => onChange(dismissQuestion(draft))}>Hatao</button>
        </div>
      )}

      {draft.unresolved.map((u, i) =>
        u.kind === 'item' ? (
          <div key={`u${i}${u.spoken}`} className={`mt-3${askSpoken === u.spoken ? ' rounded-xl ring-2 ring-warn' : ''}`} {...(askSpoken === u.spoken ? { 'aria-current': 'step' as const } : {})}>
            <ProductPicker spoken={u.spoken} quantity={u.quantity} unit={u.unit} candidates={u.candidates} products={products} onPick={(p) => { onChange(resolveItem(draft, i, p)); void repo.learnProductAlias(p.id, u.spoken).then((learned) => { if (learned) toast(`Yaad rakh liya: ${u.spoken} = ${p.name}`, 'ok'); }); }} />
            {askSpoken === u.spoken && <button type="button" className="m-3 mt-0 min-h-12 rounded-xl bg-control px-4 font-semibold" onClick={() => onChange(dismissQuestion(draft))}>Hatao</button>}
          </div>
        ) : (
          <div key={`u${i}${u.spoken}`} className="mt-3 rounded-xl border border-warn/60 bg-warn/10 p-3">
            <p className="font-semibold">&ldquo;{u.spoken}&rdquo; kaun sa grahak hai?</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {u.candidates.map((c) => (
                <button key={c.id} type="button" className="min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-solid" onClick={() => { onChange(resolveCustomer(draft, i, c)); void repo.learnCustomerAlias(c.id, u.spoken).then((learned) => { if (learned) toast(`Yaad rakh liya: ${u.spoken} = ${c.name}`, 'ok'); }); }}>{c.name}</button>
              ))}
            </div>
          </div>
        ),
      )}

      {bill && (
        <dl className="num mt-3 space-y-1 border-t border-line pt-3 text-lg">
          {totals && bill.adjust && (
            <>
              <div className="flex justify-between text-dim"><dt>Subtotal</dt><dd>{rupees(totals.subtotal)}</dd></div>
              {totals.discount > 0 && <div className="flex justify-between text-good"><dt>Chhoot</dt><dd>−{rupees(totals.discount)}</dd></div>}
              {totals.gst > 0 && <div className="flex justify-between text-dim"><dt>GST {bill.adjust.gstPercent}%</dt><dd>+{rupees(totals.gst)}</dd></div>}
              {totals.roundOff !== 0 && <div className="flex justify-between text-dim"><dt>Round-off</dt><dd>{totals.roundOff > 0 ? '+' : '−'}{rupees(Math.abs(totals.roundOff))}</dd></div>}
            </>
          )}
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

      {bill && bill.items.length > 0 && <AdjustPanel adjust={bill.adjust} onChange={(next) => onChange(setAdjust(draft, next))} />}

      {bill && udhaarNeedsCustomer(bill.udhaar, draft.customer !== undefined) && (
        <p role="status" className="mt-3 rounded-xl bg-warn/15 px-3 py-2 font-semibold text-warn">
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
