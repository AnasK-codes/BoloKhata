import { z } from 'zod';
import { businessProfileSchema } from '@bolbill/shared';

export interface AccountAuthConfig { url: string; key: string }

/** Both Supabase calls together; well under the web broker's 8 s wait, so the user sees a clear 503. */
const ACCOUNT_DEADLINE_MS = 5000;

/** Runs at session creation, before any upstream speech connection is opened. */
export async function verifyAccount(header: string | undefined, config: AccountAuthConfig, fetcher: typeof fetch = fetch, deadlineMs = ACCOUNT_DEADLINE_MS): Promise<'ok' | 'unauthorized' | 'profile_required' | 'unavailable'> {
  if (!header?.startsWith('Bearer ') || header.length > 4000) return 'unauthorized';
  const headers = { authorization: header, apikey: config.key };
  const signal = AbortSignal.timeout(deadlineMs);
  try {
    const response = await fetcher(`${config.url}/auth/v1/user`, { headers, cache: 'no-store', signal });
    if (response.status === 401 || response.status === 403) return 'unauthorized';
    if (!response.ok) return 'unavailable';
    const user = z.object({ id: z.uuid() }).safeParse(await response.json());
    if (!user.success) return 'unauthorized';
    const profiles = await fetcher(`${config.url}/rest/v1/bolbill_business_profiles?owner_id=eq.${encodeURIComponent(user.data.id)}&select=owner_id,business_name,owner_name,address,mobile,receipt_footer&limit=1`, { headers, cache: 'no-store', signal });
    if (!profiles.ok) return 'unavailable';
    const rows = z.array(z.object({ owner_id: z.uuid(), business_name: z.string(), owner_name: z.string(), address: z.string(), mobile: z.string(), receipt_footer: z.string() })).max(1).safeParse(await profiles.json());
    if (!rows.success) return 'unavailable';
    const row = rows.data[0];
    if (!row || row.owner_id !== user.data.id) return 'profile_required';
    return businessProfileSchema.safeParse({ businessName: row.business_name, ownerName: row.owner_name, address: row.address, mobile: row.mobile, receiptFooter: row.receipt_footer }).success ? 'ok' : 'profile_required';
  } catch { return 'unavailable'; }
}
