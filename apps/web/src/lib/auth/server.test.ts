import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { handleAccount } from './server';

const id = '11111111-1111-4111-8111-111111111111';
const user = { id, email: 'owner@example.test' };
const env = { SUPABASE_URL: 'https://auth.example.test', SUPABASE_ANON_KEY: 'synthetic-anon-key' };
const session = { user, access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600 };
const profile = { owner_id: id, business_name: 'Synthetic Kirana', owner_name: 'Synthetic Owner', address: 'Synthetic Lane, Demo Nagar', mobile: '9000000000', receipt_footer: 'Thank you' };
const input = { businessName: profile.business_name, ownerName: profile.owner_name, address: profile.address, mobile: profile.mobile, receiptFooter: profile.receipt_footer };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function request(action = '', body?: unknown, cookie = '', origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000/api/account${action ? `/${action}` : ''}`, { method: action ? 'POST' : 'GET',
    headers: { origin, cookie, 'content-type': 'application/json' }, ...(action ? { body: JSON.stringify(body ?? {}) } : {}) });
}
function mock(rows: unknown = [profile]) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url); calls.push({ path, ...(init ? { init } : {}) });
    if (path.includes('/token?')) return response(session);
    if (path.endsWith('/signup')) return response({ id });
    if (path.endsWith('/user')) return response(user);
    if (path.includes('/rest/')) return response(rows);
    if (path.includes('/logout')) return new Response(null, { status: 204 });
    if (path.endsWith('/session')) return response({ token: 'gateway-synthetic-token', expiresInSec: 120 });
    throw new Error('Unexpected mock request');
  };
  return { fetcher, calls };
}
const cookies = 'bolbill-access=synthetic-access; bolbill-refresh=synthetic-refresh';

describe('account API with a mocked Supabase backend', () => {
  it('checks the configured public origin behind a reverse proxy', async () => {
    const m = mock();
    const proxied = new NextRequest('http://web:3000/api/account/login', { method: 'POST', headers: { origin: 'https://shop.example.test', 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: 'synthetic-password' }) });
    expect((await handleAccount(proxied, 'login', m.fetcher, { ...env, APP_ORIGIN: 'https://shop.example.test' })).status).toBe(200);
  });
  it('reports missing setup without contacting a provider', async () => {
    const m = mock(); const res = await handleAccount(request(), 'current', m.fetcher, {});
    expect(res.status).toBe(503); expect(await res.json()).toMatchObject({ configured: false }); expect(m.calls).toHaveLength(0);
  });
  it('logs in with HttpOnly SameSite cookies and never returns tokens in JSON', async () => {
    const m = mock(); const res = await handleAccount(request('login', { email: user.email, password: 'synthetic-password' }), 'login', m.fetcher, env);
    expect(res.status).toBe(200); const body: unknown = await res.json(); expect(body).toMatchObject({ user, profile: input });
    expect(JSON.stringify(body)).not.toContain('synthetic-access');
    expect(res.cookies.get('bolbill-access')?.httpOnly).toBe(true);
    expect(res.cookies.get('bolbill-refresh')?.sameSite).toBe('lax');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('requires email confirmation without inventing an authenticated session', async () => {
    const m = mock(); const res = await handleAccount(request('signup', { email: user.email, password: 'synthetic-password' }), 'signup', m.fetcher, env);
    expect(await res.json()).toMatchObject({ user: null, confirmationRequired: true });
    expect(res.cookies.get('bolbill-access')?.maxAge).toBe(0);
  });
  it('rejects weak credentials, oversized bodies and cross-origin requests before provider access', async () => {
    const m = mock();
    expect((await handleAccount(request('signup', { email: user.email, password: 'short' }), 'signup', m.fetcher, env)).status).toBe(400);
    expect((await handleAccount(request('login', { email: 'x'.repeat(9000) }), 'login', m.fetcher, env)).status).toBe(413);
    expect((await handleAccount(request('login', {}, '', 'https://attacker.example'), 'login', m.fetcher, env)).status).toBe(403);
    expect(m.calls).toHaveLength(0);
  });
  it('returns anonymous state without reading any profile when no session exists', async () => {
    const m = mock(); const res = await handleAccount(request(), 'current', m.fetcher, env);
    expect(await res.json()).toEqual({ configured: true, user: null, profile: null }); expect(m.calls).toHaveLength(0);
  });
  it('refreshes an expired access token and rotates both cookies', async () => {
    const m = mock(); let checks = 0;
    const fetcher: typeof fetch = async (url, init) => String(url).endsWith('/user') && ++checks === 1 ? response({}, 401) : m.fetcher(url, init);
    const res = await handleAccount(request('', undefined, cookies), 'current', fetcher, env);
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ user });
    expect(m.calls.some((c) => c.path.includes('grant_type=refresh_token'))).toBe(true);
    expect(res.cookies.get('bolbill-refresh')?.value).toBe('synthetic-refresh');
  });
  it('clears invalid refresh credentials instead of granting access', async () => {
    const fetcher: typeof fetch = async () => response({}, 401);
    const res = await handleAccount(request('', undefined, cookies), 'current', fetcher, env);
    expect(await res.json()).toMatchObject({ user: null }); expect(res.cookies.get('bolbill-access')?.maxAge).toBe(0);
  });
  it('forces the owner id from the verified session when saving a business', async () => {
    const m = mock(); const res = await handleAccount(request('profile', { ...input, owner_id: 'attacker' }, cookies), 'profile', m.fetcher, env);
    expect(res.status).toBe(200);
    const write = m.calls.find((c) => c.init?.method === 'POST');
    expect(JSON.parse(String(write?.init?.body))).toMatchObject({ owner_id: id });
  });
  it('rejects a profile returned for another account', async () => {
    const m = mock([{ ...profile, owner_id: '22222222-2222-4222-8222-222222222222' }]);
    expect((await handleAccount(request('', undefined, cookies), 'current', m.fetcher, env)).status).toBe(403);
  });
  it('blocks voice before onboarding and brokers an authenticated session afterwards', async () => {
    const missing = mock([]);
    expect((await handleAccount(request('gateway-session', {}, cookies), 'gateway-session', missing.fetcher, env)).status).toBe(403);
    expect(missing.calls.some((c) => c.path.endsWith('/session'))).toBe(false);
    const m = mock(); const res = await handleAccount(request('gateway-session', {}, cookies), 'gateway-session', m.fetcher, env);
    expect(await res.json()).toEqual({ token: 'gateway-synthetic-token' });
    expect(m.calls.at(-1)?.init?.headers).toMatchObject({ authorization: 'Bearer synthetic-access' });
  });
  it('logs out and deletes both cookies', async () => {
    const m = mock(); const res = await handleAccount(request('logout', {}, cookies), 'logout', m.fetcher, env);
    expect(await res.json()).toMatchObject({ user: null });
    expect(res.cookies.get('bolbill-access')?.maxAge).toBe(0); expect(res.cookies.get('bolbill-refresh')?.maxAge).toBe(0);
  });
  it('sanitizes upstream failures and handles network outages', async () => {
    const bad: typeof fetch = async () => response({ message: 'PRIVATE_PROVIDER_DATA' }, 400);
    const res = await handleAccount(request('login', { email: user.email, password: 'synthetic-password' }), 'login', bad, env);
    expect(res.status).toBe(401); expect(JSON.stringify(await res.json())).not.toContain('PRIVATE_PROVIDER_DATA');
    const offline: typeof fetch = async () => { throw new Error('PRIVATE_PROVIDER_DATA'); };
    expect((await handleAccount(request('login', { email: user.email, password: 'synthetic-password' }), 'login', offline, env)).status).toBe(503);
  });
});
