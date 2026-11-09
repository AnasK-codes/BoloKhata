import { businessProfileSchema, type BusinessProfile } from '@bolbill/shared';
import { accountUserSchema, type AccountState } from './schema';

/**
 * TEMPORARY demo switch: with DEMO_NO_AUTH=true on the web server, nobody has to log in. The app
 * opens as a synthetic demo shop and the gateway session is requested without an account token.
 *
 * It is a server-side variable (never NEXT_PUBLIC_) and it must be exactly "true". There is no
 * on-screen banner. Remove the variable to bring login back; no
 * data or code path depends on it. The gateway must run without Supabase (ACCOUNT_AUTH_REQUIRED=false).
 */
export const isDemoNoAuth = (env: Record<string, string | undefined> = process.env): boolean => env.DEMO_NO_AUTH === 'true';

/** Synthetic: not a real person, shop or phone number. */
export const DEMO_USER = accountUserSchema.parse({ id: '11111111-1111-4111-8111-111111111111', email: 'demo@bolbill.example' });
export const DEMO_PROFILE: BusinessProfile = businessProfileSchema.parse({
  businessName: 'Demo Kirana Store',
  ownerName: 'Demo Owner',
  address: 'Demo Lane, Test Nagar',
  mobile: '9000000000',
  receiptFooter: 'Dhanyavaad! Phir aaiye.',
});

export function demoState(profile: BusinessProfile = DEMO_PROFILE): AccountState {
  return { configured: true, demo: true, user: DEMO_USER, profile };
}
