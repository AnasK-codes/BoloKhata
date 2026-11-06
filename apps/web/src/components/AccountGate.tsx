'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BusinessProfile } from '@bolbill/shared';
import { accountStateSchema, type AccountState } from '@/lib/auth/schema';
import { BusinessProfileForm } from './BusinessProfileForm';

interface AccountContext {
  user: NonNullable<AccountState['user']>;
  profile: BusinessProfile;
  saveProfile(profile: BusinessProfile): Promise<void>;
  logout(): Promise<void>;
}
const Context = createContext<AccountContext | null>(null);
export function useAccount(): AccountContext {
  const value = useContext(Context);
  if (!value) throw new Error('Account is not ready');
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
    throw new Error(response.status === 401 ? 'Email/password ya session valid nahi hai. Email verify karke login karo.' : response.status === 429 ? 'Bahut attempts hue. Thodi der baad try karo.' : response.status === 503 ? 'Cloud service/profile setup unavailable hai. Internet aur Supabase setup check karo.' : 'Request complete nahi hui. Dobara try karo.');
  }
  if (!parsed.success) throw new Error('Account service ka jawab valid nahi tha.');
  return parsed.data;
}

function AuthForm({ onSubmit }: { onSubmit(action: 'login' | 'signup', input: { email: string; password: string }): Promise<void> }) {
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const submit = async () => {
    if (signup && password !== confirmation) { setError('Dono passwords same hone chahiye.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(signup ? 'signup' : 'login', { email, password }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Login nahi hua. Internet check karo.'); }
    finally { setBusy(false); }
  };
  return <main className="auth-card mx-auto max-w-md space-y-6 px-5 py-10">
    <header><p className="text-3xl font-extrabold">Bol-<span className="text-accent">Bill</span></p>
      <h1 className="mt-6 text-2xl font-bold">{signup ? 'Apna account banao' : 'Apni dukaan mein login karo'}</h1>
      <p className="mt-2 text-dim">{signup ? 'Account → business profile → bolkar billing.' : 'Email aur password se sign in karo.'}</p></header>
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <label className="block font-semibold">Email<input required type="email" autoComplete="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 min-h-14 w-full rounded-xl bg-inset px-4 text-base" /></label>
      <label className="block font-semibold">Password<input required type="password" minLength={signup ? 8 : 1} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 min-h-14 w-full rounded-xl bg-inset px-4 text-base" /></label>
      {signup && <label className="block font-semibold">Password dobara<input required type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="mt-1 min-h-14 w-full rounded-xl bg-inset px-4 text-base" /></label>}
      {error && <p role="alert" className="text-bad">{error}</p>}
      <button disabled={busy} className="min-h-14 w-full rounded-xl bg-accent px-4 text-lg font-bold text-on-solid disabled:opacity-50">{busy ? 'Ruko…' : signup ? 'Sign up' : 'Login'}</button>
      <button type="button" disabled={busy} onClick={() => { setSignup(!signup); setError(''); setPassword(''); setConfirmation(''); }} className="min-h-12 w-full rounded-xl bg-control px-4 font-semibold">{signup ? 'Account hai? Login karo' : 'Naye ho? Sign up karo'}</button>
    </form>
  </main>;
}

function broadcast() { try { localStorage.setItem('bolbill-account-change', crypto.randomUUID()); } catch { /* Storage may be blocked; cookies still work. */ } }

/** Nothing opens local billing data or the voice gateway until account and business are ready. */
export function AccountGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccountState | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true); setError('');
    try { const result = await requestAccount(); if (current === generation.current) setState(result); }
    catch { if (current === generation.current) setError('Account load nahi hua. Internet check karke retry karo.'); }
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
    if (!result.configured || !result.profile) throw new Error('Profile save nahi hui. Cloud setup aur session check karo.');
    setState(result);
  };
  const logout = async () => { const result = await requestAccount('logout'); setState(result); broadcast(); };
  if (loading) return <main className="mx-auto max-w-md px-5 py-12" aria-busy="true">Account khul raha hai…</main>;
  if (error) return <main className="mx-auto max-w-md space-y-4 px-5 py-12"><p role="alert">{error}</p><button onClick={() => void load()} className="min-h-12 rounded-xl bg-control px-4">Retry</button></main>;
  if (!state?.configured) return <main className="mx-auto max-w-md space-y-4 px-5 py-12"><h1 className="text-2xl font-bold">Cloud login setup baaki hai</h1><p>Supabase project connect karne ke baad signup aur login khulenge. Setup steps README aur docs/AUTH.md mein hain.</p><button className="min-h-12 rounded-xl bg-control px-4" onClick={() => void load()}>Setup ke baad retry karo</button></main>;
  if (!state.user) return <>
    {state.confirmationRequired && <p role="status" className="mx-auto max-w-md bg-good/15 p-4 text-good">Verification email check karo. Email confirm karne ke baad login karo.</p>}
    <AuthForm onSubmit={async (action, input) => { const result = await requestAccount(action, input); setState(result); broadcast(); }} />
  </>;
  if (!state.profile) return <><BusinessProfileForm onSave={saveProfile} /><button className="mx-auto block min-h-12 rounded-xl bg-control px-5" onClick={() => void logout().catch(() => setError('Logout nahi hua. Retry karo.'))}>Logout</button></>;
  return <Context.Provider value={{ user: state.user, profile: state.profile, saveProfile, logout }}>{children}</Context.Provider>;
}
