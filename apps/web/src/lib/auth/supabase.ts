import { z } from 'zod';
import { businessProfileSchema, type BusinessProfile } from '@bolbill/shared';
import { accountUserSchema } from './schema';

const configSchema = z.object({ url: z.url().refine((value) => new URL(value).protocol === 'https:' || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(value)), key: z.string().min(1) });
const sessionSchema = z.object({ access_token: z.string().min(1).max(3800), refresh_token: z.string().min(1).max(3800), expires_in: z.number().int().positive().max(604800), user: accountUserSchema });
const rowSchema = z.object({ owner_id: z.uuid(), business_name: z.string(), owner_name: z.string(), address: z.string(), mobile: z.string(), receipt_footer: z.string() });
export type AuthSession = z.infer<typeof sessionSchema>;

export class AccountError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function authConfig(env: Record<string, string | undefined> = process.env) {
  const parsed = configSchema.safeParse({ url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY });
  if (!parsed.success) throw new AccountError(503, 'Cloud login setup baaki hai. SUPABASE_URL aur SUPABASE_ANON_KEY configure karo.');
  return { ...parsed.data, url: parsed.data.url.replace(/\/$/, '') };
}

/** Server-side REST adapter. Never uses a service-role key or returns provider error text. */
export function supabase(config: ReturnType<typeof authConfig>, fetcher: typeof fetch = fetch) {
  const call = async (path: string, options: { method?: string; body?: unknown; access?: string; prefer?: string } = {}) => {
    let response: Response;
    try {
      response = await fetcher(`${config.url}${path}`, {
        method: options.method ?? 'GET', cache: 'no-store', signal: AbortSignal.timeout(8000),
        headers: { apikey: config.key, 'content-type': 'application/json',
          ...(options.access ? { authorization: `Bearer ${options.access}` } : {}),
          ...(options.prefer ? { prefer: options.prefer } : {}) },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch { throw new AccountError(503, 'Cloud service se connection nahi hua. Internet check karke dobara try karo.'); }
    if (!response.ok) {
      if (response.status === 429) throw new AccountError(429, 'Bahut attempts hue. Thodi der baad try karo.');
      if (response.status >= 500) throw new AccountError(503, 'Cloud service abhi unavailable hai. Dobara try karo.');
      if (path.startsWith('/rest/')) throw new AccountError(503, 'Business profile load/save nahi hui. Supabase database setup aur connection check karo.');
      throw new AccountError(401, 'Email/password ya session valid nahi hai. Email verify karke dobara login karo.');
    }
    return response.status === 204 ? null : await response.json().catch(() => null) as unknown;
  };
  const session = (data: unknown): AuthSession => {
    const parsed = sessionSchema.safeParse(data);
    if (!parsed.success) throw new AccountError(502, 'Login service ka jawab valid nahi tha. Dobara try karo.');
    return parsed.data;
  };
  const decodeProfile = (data: unknown, ownerId: string): BusinessProfile | null => {
    const rows = z.array(rowSchema).max(1).safeParse(data);
    if (!rows.success) throw new AccountError(502, 'Business profile ka jawab valid nahi tha.');
    const row = rows.data[0];
    if (!row) return null;
    if (row.owner_id !== ownerId) throw new AccountError(403, 'Business profile access allowed nahi hai.');
    const parsed = businessProfileSchema.safeParse({ businessName: row.business_name, ownerName: row.owner_name, address: row.address, mobile: row.mobile, receiptFooter: row.receipt_footer });
    if (!parsed.success) throw new AccountError(502, 'Business profile ki details valid nahi hain.');
    return parsed.data;
  };
  return {
    async login(input: { email: string; password: string }) { return session(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: input })); },
    async signup(input: { email: string; password: string }): Promise<AuthSession | null> {
      const data = await call('/auth/v1/signup', { method: 'POST', body: input });
      const parsed = sessionSchema.safeParse(data);
      if (parsed.success) return parsed.data;
      // With email confirmation enabled, Supabase returns a user but no tokens.
      const confirmation = z.object({ id: z.uuid() }).safeParse(data);
      if (confirmation.success) return null;
      throw new AccountError(502, 'Signup service ka jawab valid nahi tha. Dobara try karo.');
    },
    async refresh(refreshToken: string) { return session(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: refreshToken } })); },
    async user(access: string) {
      const parsed = accountUserSchema.safeParse(await call('/auth/v1/user', { access }));
      if (!parsed.success) throw new AccountError(401, 'Session valid nahi hai. Dobara login karo.');
      return parsed.data;
    },
    async logout(access: string) { await call('/auth/v1/logout?scope=local', { method: 'POST', access }); },
    async profile(access: string, ownerId: string) {
      return decodeProfile(await call(`/rest/v1/bolbill_business_profiles?owner_id=eq.${encodeURIComponent(ownerId)}&select=owner_id,business_name,owner_name,address,mobile,receipt_footer&limit=1`, { access }), ownerId);
    },
    async saveProfile(access: string, ownerId: string, profile: BusinessProfile) {
      const p = businessProfileSchema.parse(profile);
      const saved = decodeProfile(await call('/rest/v1/bolbill_business_profiles?on_conflict=owner_id', {
        method: 'POST', access, prefer: 'resolution=merge-duplicates,return=representation',
        body: { owner_id: ownerId, business_name: p.businessName, owner_name: p.ownerName, address: p.address, mobile: p.mobile, receipt_footer: p.receiptFooter },
      }), ownerId);
      if (!saved) throw new AccountError(502, 'Profile save nahi hui. Dobara try karo.');
      return saved;
    },
  };
}
