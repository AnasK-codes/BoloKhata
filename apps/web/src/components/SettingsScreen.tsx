'use client';

import { useState, type ReactNode } from 'react';
import { useSettings } from '@/lib/settings';
import { useApp } from './AppProvider';
import { useAccount } from './AccountGate';
import { BusinessProfileForm } from './BusinessProfileForm';
import { backupJson, billsCsv, downloadText, ledgerCsv } from '@/lib/exportData';
import { useT } from '@/lib/i18n';
import { LanguageOptions } from './LanguagePicker';

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center justify-between gap-4 px-4 py-3">
      <span>
        <span className="block text-lg font-semibold">{label}</span>
        <span className="block text-sm text-muted">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-7 w-7 shrink-0 accent-good" />
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
  const t = useT();
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
      toast(t('settings.downloaded'), 'ok');
    } catch {
      toast(t('settings.exportFailed'), 'error');
    }
    setBusy(false);
  };

  const reset = async () => {
    if (!db) return;
    setBusy(true);
    try {
      await (await import('@/lib/db/seed')).resetDemoData(db);
      toast(t('settings.resetDone'), 'ok');
    } catch {
      toast(t('settings.resetFailed'), 'error');
    }
    setBusy(false);
    setConfirming(false);
  };

  if (editingProfile) return <BusinessProfileForm initial={profile} onCancel={() => setEditingProfile(false)} onSave={async (next) => { await saveProfile(next); setEditingProfile(false); toast(t('settings.profileSaved'), 'ok'); }} />;

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-5">
      <h1 className="text-2xl font-extrabold">{t('nav.settings')}</h1>
      <Section title={t('lang.title')}>
        <div className="space-y-3 p-4">
          <p className="text-sm text-muted">{t('lang.hint')}</p>
          <LanguageOptions />
        </div>
      </Section>

      <Section title={t('settings.account')}>
        <div className="space-y-3 p-4"><p className="text-lg font-bold">{profile.businessName}</p><p className="break-words text-dim">{user.email}</p>
          <p className="text-sm text-muted">{t('settings.cloudNote')}</p>
          <button className="min-h-12 w-full rounded-xl bg-control px-4 font-semibold" onClick={() => setEditingProfile(true)}>{t('settings.profile')}</button>
          <button disabled={busy} className="min-h-12 w-full rounded-xl bg-control px-4 font-semibold text-bad" onClick={async () => { setBusy(true); try { await logout(); } catch { toast(t('settings.logoutFailed'), 'error'); setBusy(false); } }}>{t('settings.logout')}</button>
        </div>
      </Section>

      <Section title={t('settings.display')}>
        <Toggle label={t('settings.hud')} hint={t('settings.hudHint')} checked={hud} onChange={(v) => set({ hud: v })} />
      </Section>

      <Section title={t('settings.voice')}>
        <Toggle label={t('settings.handsFree')} hint={t('settings.handsFreeHint')} checked={handsFree} onChange={(v) => set({ handsFree: v })} />
      </Section>

      <Section title={t('settings.mic')}>
        <Toggle label={t('settings.echo')} hint={t('settings.echoHint')} checked={mic.echoCancellation} onChange={(v) => set({ mic: { ...mic, echoCancellation: v } })} />
        <Toggle label={t('settings.noise')} hint={t('settings.noiseHint')} checked={mic.noiseSuppression} onChange={(v) => set({ mic: { ...mic, noiseSuppression: v } })} />
        <Toggle label={t('settings.gain')} hint={t('settings.gainHint')} checked={mic.autoGainControl} onChange={(v) => set({ mic: { ...mic, autoGainControl: v } })} />
      </Section>

      <Section title={t('settings.backup')}>
        <button type="button" disabled={busy || !repo} className="action-row" onClick={() => void exportFile('backup')}>
          <span><strong>{t('settings.fullBackup')}</strong><small>{t('settings.fullBackupHint')}</small></span>
        </button>
        <button type="button" disabled={busy || !repo} className="action-row" onClick={() => void exportFile('bills')}>
          <span><strong>{t('nav.bills')}</strong><small>{t('settings.billsHint')}</small></span>
        </button>
        <button type="button" disabled={busy || !repo} className="action-row" onClick={() => void exportFile('ledger')}>
          <span><strong>{t('nav.ledger')}</strong><small>{t('settings.ledgerHint')}</small></span>
        </button>
        <p className="px-4 py-3 text-sm text-muted">{t('settings.backupNote')}</p>
      </Section>

      <Section title={t('settings.demo')}>
        <div className="space-y-3 px-4 py-4">
          <p className="text-dim">{t('settings.demoHint')}</p>
          {confirming ? (
            <div className="space-y-2" role="alertdialog" aria-label={t('settings.resetConfirm')}>
              <p className="font-bold text-bad">{t('settings.resetSure')}</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy || !db} onClick={() => void reset()} className="min-h-14 flex-1 rounded-xl bg-bad text-lg font-bold text-on-solid disabled:opacity-50">{t('settings.resetYes')}</button>
                <button type="button" onClick={() => setConfirming(false)} className="min-h-14 rounded-xl bg-control px-6 text-lg font-semibold">{t('common.no')}</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={!db} onClick={() => setConfirming(true)} className="min-h-14 w-full rounded-xl bg-control text-lg font-semibold disabled:opacity-50">{t('settings.reset')}</button>
          )}
        </div>
      </Section>
    </main>
  );
}
