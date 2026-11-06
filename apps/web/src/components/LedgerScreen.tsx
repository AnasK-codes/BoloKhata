'use client';

import { useMemo, useState } from 'react';
import { daysSince } from '@bolbill/shared';
import { reminderLink, reminderText } from '@/lib/reminder';
import { formatDate, rupees } from '@/lib/format';
import { useLive } from '@/lib/db/live';
import { useOnline } from '@/lib/useOnline';
import { useApp } from './AppProvider';
import { CustomerForm } from './CustomerForm';
import { OfflineBadge, StateView } from './StateView';
import { ReverseDialog } from './ReverseDialog';
import { StatementSheet } from './StatementSheet';
import { useAccount } from './AccountGate';
import Link from 'next/link';

export function LedgerScreen() {
  const { repo, dataError, toast } = useApp();
  const { profile } = useAccount();
  const online = useOnline();
  const [query, setQuery] = useState('');
  const [oldestFirst, setOldestFirst] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string; name: string; aliases: string; mobile?: string; address?: string } | null>(null);

  const list = useLive(repo ? () => repo.listCustomersWithBalance() : null, [repo]);
  const rows = useLive(repo && selected ? () => repo.getCustomerStatement(selected) : null, [repo, selected]);

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data ?? [])
      .filter((x) => !q || [x.customer.name, ...x.customer.aliases].some((n) => n.toLowerCase().includes(q)))
      .sort((a, b) => oldestFirst
        ? (b.balance > 0 ? 1 : 0) - (a.balance > 0 ? 1 : 0) || (a.oldestUnpaidAt ?? Infinity) - (b.oldestUnpaidAt ?? Infinity) || a.customer.name.localeCompare(b.customer.name)
        : b.balance - a.balance || a.customer.name.localeCompare(b.customer.name));
  }, [list.data, query, oldestFirst]);
  const outstanding = (list.data ?? []).reduce((sum, x) => sum + Math.max(0, x.balance), 0);

  if (dataError) return <main className="mx-auto max-w-md px-4 py-6"><StateView kind="error" title="Data nahi khul paya" hint={dataError} /></main>;

  const current = (list.data ?? []).find((x) => x.customer.id === selected);

  if (form && repo) {
    return (
      <CustomerForm
        repo={repo}
        {...(form.id ? { customerId: form.id } : {})}
        initial={{ name: form.name, aliases: form.aliases, mobile: form.mobile ?? '', address: form.address ?? '' }}
        onToast={toast}
        onDone={(saved) => {
          setForm(null);
          if (saved && form.id && !(list.data ?? []).some((x) => x.customer.id === form.id)) setSelected(null);
        }}
      />
    );
  }

  const pay = async () => {
    if (!repo || !selected) return;
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0) {
      toast('Rakam poora rupaya ho, 0 se zyada.', 'error');
      return;
    }
    setBusy(true);
    const result = await repo.addPayment(selected, value);
    setBusy(false);
    if (!result.ok) toast(result.error, 'error');
    else {
      toast(`${rupees(value)} mil gaye`, 'ok');
      setAmount('');
    }
  };

  if (selected && current) {
    const statement = [...(rows.data ?? [])].reverse();
    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-5">
        <button type="button" onClick={() => setSelected(null)} className="min-h-12 rounded-xl bg-raised px-4 font-semibold">← Wapas (back)</button>
        <header>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-extrabold">{current.customer.name}</h1>
            <button type="button" className="min-h-12 shrink-0 rounded-xl bg-raised px-4 font-semibold" onClick={() => setForm({ id: current.customer.id, name: current.customer.name, aliases: current.customer.aliases.join(', '), mobile: current.customer.mobile, address: current.customer.address })}>Badlo</button>
          </div>
          <p className={`num text-5xl font-extrabold ${current.balance > 0 ? 'text-warn' : 'text-good'}`}>{rupees(Math.abs(current.balance))}</p>
          <p className="text-dim">{current.balance > 0 ? 'udhaar baaki' : current.balance < 0 ? 'advance (zyada diya)' : 'koi udhaar nahi'}</p>
        </header>
        <form className="rounded-2xl bg-card p-4" onSubmit={(e) => { e.preventDefault(); void pay(); }}>
          <label htmlFor="pay" className="font-bold">Payment mila</label>
          <div className="mt-2 flex gap-2">
            <input id="pay" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="₹ rakam" className="num min-h-14 min-w-0 flex-1 rounded-xl bg-inset px-4 text-xl" />
            <button type="submit" disabled={busy || amount === ''} className="min-h-14 rounded-xl bg-good px-5 text-lg font-bold text-on-solid disabled:opacity-40">Likho</button>
          </div>
        </form>
        {current.balance > 0 && (
          <a
            href={reminderLink(current.customer.mobile, reminderText({ businessName: profile.businessName, customerName: current.customer.name, balance: current.balance, days: current.oldestUnpaidAt === null ? null : daysSince(current.oldestUnpaidAt, Date.now()) })) ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 w-full items-center justify-center rounded-xl bg-good px-4 font-bold text-on-solid"
          >
            WhatsApp pe yaad dilao
          </a>
        )}
        {current.balance > 0 && !current.customer.mobile && <p className="text-sm text-muted">Mobile number nahi hai, isliye WhatsApp aapse contact chunne ko kahega. "Badlo" mein number bhar do.</p>}
        <button type="button" disabled={(rows.data ?? []).length === 0} className="min-h-12 w-full rounded-xl bg-raised px-4 font-semibold disabled:opacity-40" onClick={() => window.print()}>Statement print / PDF</button>
        <StatementSheet businessName={profile.businessName} customerName={current.customer.name} rows={rows.data ?? []} printedAt={Date.now()} />
        <section aria-label="Statement">
          <h2 className="mb-2 text-lg font-bold">Hisab ki list</h2>
          {rows.error ? <StateView kind="error" title="Hisab nahi khula" hint="Page reload karke try karo." /> : rows.loading ? <StateView kind="loading" title="Khul raha hai" /> : statement.length === 0 ? (
            <StateView kind="empty" title="Abhi koi hisab nahi" hint="Bill ya payment likhte hi yahan dikhega." />
          ) : (
            <ul className="divide-y divide-line rounded-2xl bg-card">
              {statement.map((r) => (
                <li key={r.entry.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="font-semibold">{r.entry.reversesEntryId ? 'Reversal' : r.entry.type === 'udhaar' ? 'Udhaar' : 'Payment mila'}{r.entry.note ? ` · ${r.entry.note}` : ''}</p>
                    <p className="text-sm text-muted">{formatDate(r.entry.createdAt)}</p>
                    {!r.entry.reversesEntryId && !statement.some((s) => s.entry.reversesEntryId === r.entry.id) && (
                      r.entry.billId ? <Link href="/bills" className="inline-flex min-h-12 items-center text-info">Bill dekho / reverse</Link> :
                        <button className="min-h-12 text-bad" onClick={() => setReverseId(r.entry.id)}>Galat entry reverse karo</button>
                    )}
                    {statement.some((s) => s.entry.reversesEntryId === r.entry.id) && <p className="text-sm text-muted">Reversed</p>}
                  </div>
                  <div className="num text-right">
                    <p className={`font-bold ${r.entry.type === 'udhaar' ? 'text-warn' : 'text-good'}`}>{r.entry.type === 'udhaar' ? '+' : '−'}{rupees(r.entry.amount)}</p>
                    <p className="text-sm text-muted">baaki {rupees(r.balance)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {reverseId && <ReverseDialog key={reverseId} onCancel={() => setReverseId(null)} onReverse={async (reason) => {
          const result = await repo!.reverseLedgerEntry(reverseId, reason);
          if (result.ok) { setReverseId(null); toast('Entry reverse ho gayi.', 'ok'); }
          return result;
        }} />}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-5">
      <OfflineBadge online={online} />
      <header>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold">Khata</h1>
          <button type="button" className="min-h-12 rounded-xl bg-accent px-5 font-bold text-on-solid" onClick={() => setForm({ name: '', aliases: '' })}>+ Naya grahak</button>
        </div>
        <p className="text-dim">Kul baaki udhaar (total outstanding)</p>
        <p className="num text-5xl font-extrabold text-warn">{list.loading ? '…' : rupees(outstanding)}</p>
      </header>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Grahak dhundo (search)" aria-label="Grahak dhundo" className="min-h-14 w-full rounded-xl bg-inset px-4 text-lg" />
      <div className="flex gap-2" role="group" aria-label="Sort">
        <button type="button" aria-pressed={!oldestFirst} onClick={() => setOldestFirst(false)} className={`min-h-12 flex-1 rounded-xl px-3 font-semibold ${!oldestFirst ? 'bg-ink text-canvas' : 'bg-raised'}`}>Zyada baaki pehle</button>
        <button type="button" aria-pressed={oldestFirst} onClick={() => setOldestFirst(true)} className={`min-h-12 flex-1 rounded-xl px-3 font-semibold ${oldestFirst ? 'bg-ink text-canvas' : 'bg-raised'}`}>Sabse purana pehle</button>
      </div>
      {list.loading || !repo ? (
        <StateView kind="loading" title="Khata khul raha hai" />
      ) : list.error ? (
        <StateView kind="error" title="Khata nahi khul paya" hint="Page reload karke dekho." />
      ) : sorted.length === 0 ? (
        <StateView kind="empty" title={query ? 'Koi grahak nahi mila' : 'Abhi koi grahak nahi'} hint={query ? 'Doosra naam try karo.' : 'Pehla bill bolo, grahak apne aap judega.'} />
      ) : (
        <ul className="divide-y divide-line rounded-2xl bg-card">
          {sorted.map(({ customer, balance, oldestUnpaidAt }) => (
            <li key={customer.id}>
              <button type="button" onClick={() => setSelected(customer.id)} className="flex min-h-16 w-full items-center justify-between gap-3 px-4 py-3 text-left active:bg-raised">
                <span>
                  <span className="block text-lg font-semibold">{customer.name}</span>
                  {balance > 0 && oldestUnpaidAt !== null && <span className="block text-sm text-muted">{daysSince(oldestUnpaidAt, Date.now())} din se baaki</span>}
                </span>
                <span className={`num text-xl font-bold ${balance > 0 ? 'text-warn' : balance < 0 ? 'text-info' : 'text-muted'}`}>{rupees(balance)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
