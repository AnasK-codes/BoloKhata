'use client';

import { useState, type ReactNode } from 'react';
import { useSettings } from '@/lib/settings';
import { useApp } from './AppProvider';
import { useAccount } from './AccountGate';
import { BusinessProfileForm } from './BusinessProfileForm';
import { backupJson, billsCsv, downloadText, ledgerCsv } from '@/lib/exportData';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-lg font-semibold">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-7 w-7 shrink-0 accent-lime-600" />
    </label>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-base font-bold text-dim">{title}</h2>
    <div className="divide-y divide-line rounded-2xl bg-card">{children}</div>
  </section>
);

export function SettingsScreen() {
  const { db, repo, toast } = useApp();
  const { user, profile, saveProfile, logout } = useAccount();
  const [editingProfile, setEditingProfile] = useState(false);
  const hud = useSettings((s) => s.hud);
  const handsFree = useSettings((s) => s.handsFree);
  const mic = useSettings((s) => s.mic);
  const set = useSettings((s) => s.set);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const exportFile = async (kind: 'backup' | 'bills' | 'ledger') => {
    if (!repo) return;
    setBusy(true);
    try {
      const data = await repo.exportAll();
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'backup') downloadText(`bol-bill-backup-${stamp}.json`, backupJson(data, Date.now()), 'application/json');
      else if (kind === 'bills') downloadText(`bol-bill-bills-${stamp}.csv`, billsCsv(data), 'text/csv');
      else downloadText(`bol-bill-khata-${stamp}.csv`, ledgerCsv(data), 'text/csv');
      toast('File download ho gayi', 'ok');
    } catch {
      toast('Export nahi hua. Dobara try karo.', 'error');
    }
    setBusy(false);
  };

  const reset = async () => {
    if (!db) return;
    setBusy(true);
    try {
      await (await import('@/lib/db/seed')).resetDemoData(db);
      toast('Demo data reset ho gaya', 'ok');
    } catch {
      toast('Reset nahi hua. Dobara try karo.', 'error');
    }
    setBusy(false);
    setConfirming(false);
  };

  if (editingProfile) return <BusinessProfileForm initial={profile} onCancel={() => setEditingProfile(false)} onSave={async (next) => { await saveProfile(next); setEditingProfile(false); toast('Business profile aur bill template save ho gaye.', 'ok'); }} />;

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-5">
      <h1 className="text-2xl font-extrabold">Settings</h1>
      <Section title="Account aur business">
        <div className="space-y-3 p-4"><p className="text-lg font-bold">{profile.businessName}</p><p className="break-words text-dim">{user.email}</p>
          <p className="text-sm text-muted">Login aur profile cloud mein hain. Bills aur khata is account ke liye sirf is device par hain.</p>
          <button className="min-h-12 w-full rounded-xl bg-control px-4 font-semibold" onClick={() => setEditingProfile(true)}>Business profile / bill template</button>
          <button disabled={busy} className="min-h-12 w-full rounded-xl bg-control px-4 font-semibold text-bad" onClick={async () => { setBusy(true); try { await logout(); } catch { toast('Logout nahi hua. Dobara try karo.', 'error'); setBusy(false); } }}>Logout</button>
        </div>
      </Section>

      <Section title="Dikhao (display)">
        <Toggle label="Latency HUD" hint="Har turn ka measured time voice screen par dikhao." checked={hud} onChange={(v) => set({ hud: v })} />
      </Section>

      <Section title="Awaaz (voice)">
        <Toggle label="Hands-free confirm" hint="Bill sunane ke baad 4 second khud sunega: 'haan' ya 'nahi'. Abhi band." checked={handsFree} onChange={(v) => set({ handsFree: v })} />
      </Section>

      <Section title="Mic processing">
        <Toggle label="Echo cancellation" hint="Speaker ki awaaz mic mein wapas aane se rokta hai." checked={mic.echoCancellation} onChange={(v) => set({ mic: { ...mic, echoCancellation: v } })} />
        <Toggle label="Noise suppression" hint="Shor kam karta hai. Kabhi awaaz bhi dabata hai: phone par test karo." checked={mic.noiseSuppression} onChange={(v) => set({ mic: { ...mic, noiseSuppression: v } })} />
        <Toggle label="Auto gain" hint="Awaaz apne aap tez/dheemi karta hai." checked={mic.autoGainControl} onChange={(v) => set({ mic: { ...mic, autoGainControl: v } })} />
      </Section>

      <Section title="Backup / export">
        <button type="button" disabled={busy || !repo} className="action-row" onClick={() => void exportFile('backup')}>
          <span><strong>Poora backup</strong><small>Sab data ek JSON file mein</small></span>
        </button>
        <button type="button" disabled={busy || !repo} className="action-row" onClick={() => void exportFile('bills')}>
          <span><strong>Bills</strong><small>CSV, Excel mein khulta hai</small></span>
        </button>
        <button type="button" disabled={busy || !repo} className="action-row" onClick={() => void exportFile('ledger')}>
          <span><strong>Khata</strong><small>Udhaar aur payments, CSV</small></span>
        </button>
        <p className="px-4 py-3 text-sm text-muted">Data sirf is phone mein hai, isliye kabhi kabhi backup rakho. Backup se wapas laane ka button abhi nahi hai.</p>
      </Section>

      <Section title="Demo data">
        <div className="space-y-3 px-4 py-4">
          <p className="text-dim">Saare bill, khata aur samaan hata kar nakli (synthetic) demo data wapas laata hai.</p>
          {confirming ? (
            <div className="space-y-2" role="alertdialog" aria-label="Reset confirm">
              <p className="font-bold text-bad">Pakka? Yeh wapas nahi hoga. (This cannot be undone.)</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy || !db} onClick={() => void reset()} className="min-h-14 flex-1 rounded-xl bg-red-500 text-lg font-bold text-white disabled:opacity-50">Haan, reset karo</button>
                <button type="button" onClick={() => setConfirming(false)} className="min-h-14 rounded-xl bg-control px-6 text-lg font-semibold">Nahi</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={!db} onClick={() => setConfirming(true)} className="min-h-14 w-full rounded-xl bg-control text-lg font-semibold disabled:opacity-50">Demo data reset karo</button>
          )}
        </div>
      </Section>
    </main>
  );
}
