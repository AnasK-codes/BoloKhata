import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { accountStateSchema } from './schema';
import { isDemoNoAuth } from './demo';
import { handleAccount } from './server';

const demoEnv = { DEMO_NO_AUTH: 'true' };
const input = { businessName: 'Edited Kirana', ownerName: 'Edited Owner', address: 'Edited Lane, Demo Nagar', mobile: '9111111111', receiptFooter: 'Thanks' };
function request(action = '', body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000/api/account${action ? `/${action}` : ''}`, {
    method: action ? 'POST' : 'GET',
    headers: { origin, 'content-type': 'application/json' },
    ...(action ? { body: JSON.stringify(body ?? {}) } : {}),
  });
}
const never: typeof fetch = () => { throw new Error('no network call is expected'); };

describe('isDemoNoAuth', () => {
  it('is on only for the exact value "true"', () => {
    expect(isDemoNoAuth({ DEMO_NO_AUTH: 'true' })).toBe(true);
    for (const v of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) expect(isDemoNoAuth({ DEMO_NO_AUTH: v })).toBe(false);
  });
});

describe('account API with demo login switched on', () => {
  it('opens straight to a synthetic demo account and profile, with no Supabase and no network', async () => {
    const response = await handleAccount(request(), 'current', never, demoEnv);
    expect(response.status).toBe(200);
    const state = accountStateSchema.parse(await response.json());
    expect(state).toMatchObject({ configured: true, demo: true, user: { email: expect.stringContaining('demo') }, profile: { businessName: expect.stringContaining('Demo') } });
  });

  it('login, signup and logout all return the demo account without checking anything', async () => {
    for (const action of ['login', 'signup', 'logout']) {
      const response = await handleAccount(request(action, { email: 'anyone@example.test', password: 'whatever' }), action, never, demoEnv);
      expect(response.status, action).toBe(200);
      expect(accountStateSchema.parse(await response.json())).toMatchObject({ configured: true, demo: true, user: { email: expect.any(String) } });
    }
  });

  it('accepts a valid business profile for the session and refuses an invalid one', async () => {
    const ok = await handleAccount(request('profile', input), 'profile', never, demoEnv);
    expect(accountStateSchema.parse(await ok.json()).profile).toMatchObject({ businessName: 'Edited Kirana' });
    const bad = await handleAccount(request('profile', { businessName: '' }), 'profile', never, demoEnv);
    expect(bad.status).toBe(400);
    // An error must not look like "setup is missing", or the app would show the setup screen.
    expect(await bad.json()).not.toHaveProperty('configured', false);
  });

  it('still refuses a cross-origin write, so a web page elsewhere cannot poke it', async () => {
    const response = await handleAccount(request('login', {}, 'https://evil.example'), 'login', never, demoEnv);
    expect(response.status).toBe(403);
  });

  it('asks the gateway for a session without any account token', async () => {
    const calls: RequestInit[] = [];
    const fetcher: typeof fetch = async (_url, init) => { calls.push(init ?? {}); return new Response(JSON.stringify({ token: 'gateway-synthetic-token', expiresInSec: 120 }), { status: 200, headers: { 'content-type': 'application/json' } }); };
    const response = await handleAccount(request('gateway-session', {}), 'gateway-session', fetcher, demoEnv);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token: 'gateway-synthetic-token' });
    expect(new Headers(calls[0]?.headers).get('authorization')).toBeNull();
  });

  it('an unknown action is still a 404', async () => {
    expect((await handleAccount(request('nope', {}), 'nope', never, demoEnv)).status).toBe(404);
  });

  it('does nothing different when the switch is off: without Supabase it still says setup is missing', async () => {
    const response = await handleAccount(request(), 'current', never, {});
    expect(await response.json()).toMatchObject({ configured: false });
  });
});
