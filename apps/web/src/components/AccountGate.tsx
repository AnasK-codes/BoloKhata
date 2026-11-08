'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StateView } from './StateView';
import type { BusinessProfile } from '@bolbill/shared';
import { accountStateSchema, type AccountState } from '@/lib/auth/schema';
import { BusinessProfileForm } from './BusinessProfileForm';
import { t, useT } from '@/lib/i18n';

interface AccountContext {
  user: NonNullable<AccountState['user']>;
  profile: BusinessProfile;
  saveProfile(profile: BusinessProfile): Promise<void>;
  logout(): Promise<void>;
}
const Context = createContext<AccountContext | null>(null);
export function useAccount(): AccountContext {
  const value = useContext(Context);
  if (!value) throw new Error('Account is not ready'); // i18n-ignore: developer error, never shown
  return value;
}

async function requestAccount(action = '', input?: unknown): Promise<AccountState> {
  const response = await fetch(`/api/account${action ? `/${action}` : ''}`, {
    method: action ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(action ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(input ?? {}) } : {}),
  });
  const body: unknown = await response.json();
  const parsed = accountStateSchema.safeParse(body);
  if (parsed.success && !parsed.data.configured) return parsed.data;
  if (!response.ok) {
    throw new Error(response.status === 401 ? t('auth.badSession') : response.status === 429 ? t('auth.tooMany') : response.status === 503 ? t('auth.unavailable') : t('auth.failed'));
  }
  if (!parsed.success) throw new Error(t('auth.invalidReply'));
  return parsed.data;
}

function AuthForm({ onSubmit }: { onSubmit(action: 'login' | 'signup', input: { email: string; password: string }): Promise<void> }) {
  const tr = useT();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async () => {
    if (signup && password !== confirmation) { setError(tr('auth.mismatch')); return; }
    setBusy(true); setError('');
    try { await onSubmit(signup ? 'signup' : 'login', { email, password }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : tr('auth.loginFailed')); }
    finally { setBusy(false); }
  };
  return <main className="auth-card mx-auto max-w-md space-y-6 px-5 py-10">
    <header><p className="text-3xl font-extrabold">{tr('app.name')}</p>
      <h1 className="mt-6 text-2xl font-bold">{signup ? tr('auth.signupTitle') : tr('auth.loginTitle')}</h1>
      <p className="mt-2 text-dim">{signup ? tr('auth.signupHint') : tr('auth.loginHint')}</p></header>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="block font-semibold">{tr('auth.email')}<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 min-h-14 w-full rounded-xl bg-inset px-4 text-base" /></label>
      <label className="block font-semibold">{tr('auth.password')}<input required type="password" minLength={signup ? 8 : 1} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 min-h-14 w-full rounded-xl bg-inset px-4 text-base" /></label>
      {signup && <label className="block font-semibold">{tr('auth.passwordAgain')}<input required type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1 min-h-14 w-full rounded-xl bg-inset px-4 text-base" /></label>}
      {error && <p role="alert" className="text-bad">{error}</p>}
      <button disabled={busy} className="min-h-14 w-full rounded-xl bg-accent px-4 text-lg font-bold text-on-solid disabled:opacity-50">{busy ? tr('auth.wait') : signup ? tr('auth.signup') : tr('auth.login')}</button>
      <button type="button" disabled={busy} onClick={() => { setSignup(!signup); setError(''); setPassword(''); setConfirmation(''); }} className="min-h-12 w-full rounded-xl bg-control px-4 font-semibold">{signup ? tr('auth.haveAccount') : tr('auth.newHere')}</button>
    </form>
  </main>;
}

function broadcast() { try { localStorage.setItem('bolbill-account-change', crypto.randomUUID()); } catch { /* Storage may be blocked; cookies still work. */ } }

/** Nothing opens local billing data or the voice gateway until account and business are ready. */
export function AccountGate({ children }: { children: ReactNode }) {
  const tr = useT();
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try { const result = await requestAccount(); if (current === generation.current) setState(result); }
    catch { if (current === generation.current) setError(t('auth.loadFailed')); }
    finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    // Confirmation links may return implicit-flow tokens. Login itself always uses server cookies.
    if (/access_token=|refresh_token=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    void load();
    const changed = (event: StorageEvent) => { if (event.key === 'bolbill-account-change') void load(); };
    const expired = () => void load();
    window.addEventListener('storage', changed);
    window.addEventListener('bolbill-session-expired', expired);
    return () => { generation.current++; window.removeEventListener('storage', changed); window.removeEventListener('bolbill-session-expired', expired); };
  }, [load]);
  const saveProfile = async (profile: BusinessProfile) => {
    const result = await requestAccount('profile', profile);
    if (!result.configured || !result.profile) throw new Error(t('auth.profileSaveFailed'));
    setState(result);
  };
  const logout = async () => { const result = await requestAccount('logout'); setState(result); broadcast(); };
  if (loading) return <main className="mx-auto max-w-md px-5 py-12" aria-busy="true"><StateView kind="loading" title={tr('auth.opening')} /></main>;
  if (error) return <main className="mx-auto max-w-md space-y-4 px-5 py-12"><p role="alert">{error}</p><button onClick={() => void load()} className="min-h-12 rounded-xl bg-control px-4">{tr('auth.retry')}</button></main>;
  if (!state?.configured) return <main className="mx-auto max-w-md space-y-4 px-5 py-12"><h1 className="text-2xl font-bold">{tr('auth.setupTitle')}</h1><p>{tr('auth.setupHint')}</p><button className="min-h-12 rounded-xl bg-control px-4" onClick={() => void load()}>{tr('auth.setupRetry')}</button></main>;
  if (!state.user) return <>
    {state.confirmationRequired && <p role="status" className="mx-auto max-w-md bg-good/15 p-4 text-good">{tr('auth.verify')}</p>}
    <AuthForm onSubmit={async (action, input) => { const result = await requestAccount(action, input); setState(result); broadcast(); }} />
  </>;
  if (!state.profile) return <><BusinessProfileForm onSave={saveProfile} /><button className="mx-auto block min-h-12 rounded-xl bg-control px-5" onClick={() => void logout().catch(() => setError(tr('settings.logoutFailed')))}>{tr('settings.logout')}</button></>;
  return <Context.Provider value={{ user: state.user, profile: state.profile, saveProfile, logout }}>{children}</Context.Provider>;
}
