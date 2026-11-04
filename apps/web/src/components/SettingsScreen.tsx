'use client';

import { useState, type ReactNode } from 'react';
import { resetDemoData } from '@/lib/db/seed';
import { useSettings } from '@/lib/settings';
import { useApp } from './AppProvider';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-lg font-semibold">{label}</span>
        <span className="block text-sm text-stone-400">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-7 w-7 shrink-0 accent-amber-400" />
    </label>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-sm font-bold uppercase tracking-wide text-stone-400">{title}</h2>
    <div className="divide-y divide-stone-800 rounded-2xl bg-[#1d2128]">{children}</div>
  </section>
);

export function SettingsScreen() {
  const { db, toast } = useApp();
  const hud = useSettings((s) => s.hud);
  const handsFree = useSettings((s) => s.handsFree);
  const mic = useSettings((s) => s.mic);
  const set = useSettings((s) => s.set);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    if (!db) return;
    setBusy(true);
    try {
      await resetDemoData(db);
      toast('Demo data reset ho gaya', 'ok');
    } catch {
      toast('Reset nahi hua. Dobara try karo.', 'error');
    }
    setBusy(false);
    setConfirming(false);
  };

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-5">
      <h1 className="text-2xl font-extrabold">Settings</h1>

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

      <Section title="Demo data">
        <div className="space-y-3 px-4 py-4">
          <p className="text-stone-300">Saare bill, khata aur samaan hata kar nakli (synthetic) demo data wapas laata hai.</p>
          {confirming ? (
            <div className="space-y-2" role="alertdialog" aria-label="Reset confirm">
              <p className="font-bold text-red-300">Pakka? Yeh wapas nahi hoga. (This cannot be undone.)</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy || !db} onClick={() => void reset()} className="min-h-14 flex-1 rounded-xl bg-red-500 text-lg font-bold text-white disabled:opacity-50">Haan, reset karo</button>
                <button type="button" onClick={() => setConfirming(false)} className="min-h-14 rounded-xl bg-stone-700 px-6 text-lg font-semibold">Nahi</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={!db} onClick={() => setConfirming(true)} className="min-h-14 w-full rounded-xl bg-stone-700 text-lg font-semibold disabled:opacity-50">Demo data reset karo</button>
          )}
        </div>
      </Section>
    </main>
  );
}
