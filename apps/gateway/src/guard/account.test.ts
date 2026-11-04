import { describe, expect, it } from 'vitest';
import { verifyAccount } from './account';
import { buildServer } from '../server';
import { testConfig } from '../testConfig';

const id = '11111111-1111-4111-8111-111111111111';
const config = { url: 'https://auth.example.test', key: 'synthetic-key' };
const profile = { owner_id: id, business_name: 'Synthetic Kirana', owner_name: 'Synthetic Owner', address: 'Synthetic Lane, Demo Nagar', mobile: '9000000000', receipt_footer: 'Thank you' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const good: typeof fetch = async (url) => json(String(url).endsWith('/user') ? { id } : [profile]);

describe('gateway account guard', () => {
  it('rejects absent or malformed tokens without an upstream request', async () => {
    const never: typeof fetch = async () => { throw new Error('must not call'); };
    expect(await verifyAccount(undefined, config, never)).toBe('unauthorized');
    expect(await verifyAccount('Basic bad', config, never)).toBe('unauthorized');
  });
  it('validates the provider identity and requires a complete owned profile', async () => {
    expect(await verifyAccount('Bearer synthetic', config, good)).toBe('ok');
    const missing: typeof fetch = async (url) => json(String(url).endsWith('/user') ? { id } : []);
    expect(await verifyAccount('Bearer synthetic', config, missing)).toBe('profile_required');
    const wrong: typeof fetch = async (url) => json(String(url).endsWith('/user') ? { id } : [{ ...profile, owner_id: '22222222-2222-4222-8222-222222222222' }]);
    expect(await verifyAccount('Bearer synthetic', config, wrong)).toBe('profile_required');
  });
  it('fails closed for invalid credentials and provider outages', async () => {
    expect(await verifyAccount('Bearer synthetic', config, async () => json({}, 401))).toBe('unauthorized');
    expect(await verifyAccount('Bearer synthetic', config, async () => json({}, 500))).toBe('unavailable');
    expect(await verifyAccount('Bearer synthetic', config, async () => { throw new Error('offline'); })).toBe('unavailable');
  });
  it('protects session issuance while retaining origin/rate/credit guards', async () => {
    const app = buildServer(testConfig({ LOG_LEVEL: 'silent', SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.key }), { accountFetch: good });
    try {
      const blocked = await app.inject({ method: 'POST', url: '/session', headers: { origin: 'http://localhost:3000' } });
      expect(blocked.statusCode).toBe(401);
      const allowed = await app.inject({ method: 'POST', url: '/session', headers: { origin: 'http://localhost:3000', authorization: 'Bearer synthetic' } });
      expect(allowed.statusCode).toBe(200); expect(allowed.json()).toHaveProperty('token');
    } finally { await app.close(); }
  });
  it('requires both cloud settings when authentication is requested', () => {
    expect(() => testConfig({ ACCOUNT_AUTH_REQUIRED: 'true' })).toThrow('SUPABASE_URL');
    expect(() => testConfig({ SUPABASE_URL: config.url })).toThrow('SUPABASE_URL');
    expect(testConfig({ SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.key }).accountAuth).toEqual(config);
  });
});
