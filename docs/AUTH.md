# Accounts, business profiles and receipts

Bol-Bill uses Supabase email/password authentication and one cloud business profile per user, through existing `fetch` and Zod packages. No extra dependency, AWS service or custom password database was added.

## Connect your project

1. Create a Supabase project. Enable email/password signup. Keep email confirmation enabled for the public app and configure working email delivery. Set the Auth Site URL to `http://localhost:3000` for development and your HTTPS URL for deployment, with the corresponding redirect allowlist. The confirmation link confirms the account; the user then signs in with email/password. Tokens returned in URL fragments are discarded rather than stored in browser storage.
2. Run [`supabase/migrations/202611040001_business_profiles.sql`](../supabase/migrations/202611040001_business_profiles.sql) in the SQL editor (safe to run again). It creates `bolbill_business_profiles` with validated fields and owner-only row-level security, and grants `authenticated` only select, insert and update (Supabase's default grant includes TRUNCATE, which RLS does not cover). Anonymous users have no table access. Checked on a local Postgres 18 with a stand-in `auth` schema, not on a live Supabase project.
3. Copy `apps/web/.env.example` to **`apps/web/.env.local`**. Fill `SUPABASE_URL` and `SUPABASE_ANON_KEY` with the project URL and anon/publishable key. Never use a service-role key. These variables stay on Next's server and have no `NEXT_PUBLIC_` prefix.
4. Put the **same** URL/key in the root `.env` for the gateway; set `ACCOUNT_AUTH_REQUIRED=true` so missing credentials fail gateway startup. A configured URL/key automatically enables gateway authentication even without that flag. Legacy/mock gateway runs without cloud settings remain available for automated tests; do not deploy that configuration publicly.

`DATABASE_URL` is optional and is used only for administrator/migration connections. A PostgreSQL connection string/password does not replace the project's publishable/anon API key required by Supabase Auth and the Data API. Never put the database URL in a public environment variable or browser code.
5. Restart with `pnpm dev`. Sign up, confirm the email, log in, and save business name, owner name, ten-digit business mobile number and address. Edit the receipt footer with the live preview of one simple layout. Settings → Business profile / bill template edits it later. Settings → Logout signs out.
6. Add products in Samaan, or explicitly choose synthetic demo-data reset in Settings for a demo/test session. New accounts start empty; signup inserts no fictional debts.

Production compose reads cloud settings from root `.env` and passes only the URL/key to Next's server. It uses `GATEWAY_INTERNAL_URL=http://gateway:8080` for the session broker and `APP_ORIGIN=https://<DOMAIN>` for same-origin checks behind Caddy. For other hosting, set `APP_ORIGIN` to the app's canonical public origin. Gnani/LLM keys stay gateway-only. STT/TTS parameters are unchanged.

## Data and sessions

- Supabase handles account identities/password verification and stores business details. The app uses no service-role access or plaintext password storage. The profile's `owner_id` comes from the verified identity, never a form field.
- Tokens live in HttpOnly, SameSite=Lax cookies (`Secure` in production), never localStorage or response JSON. The server validates users through Supabase, refreshes expired sessions and clears invalid refresh credentials. API responses are `no-store`; the service worker ignores `/api/`.
- Mutations require the same request Origin and bounded JSON. The gateway's own account check (two Supabase calls) has one 5 s deadline and fails closed with 503 `account_service_unavailable`. Provider failures are sanitized. Supabase's auth rate limits apply. Logout clears browser cookies and attempts to revoke the current provider session; an outage can prevent remote revocation.
- Onboarding is required by the UI and voice-session broker. The gateway independently checks the account/profile before issuing its existing single-use WebSocket token. Origin/rate/credit guards remain. Audio still goes directly to the gateway; Next brokers only session creation, outside the audio-frame path.
- Bills, customers, catalog and khata remain **local to the device**, in `bolbill-account-<user-id>` IndexedDB databases. Cloud login does **not** sync those records. Logout unmounts the mic/socket/session; other tabs recheck when sign-in/out changes. Namespaces separate app data but do not encrypt browser storage against someone with local browser access.
- Fresh page loads require the cloud account/profile check. An already-open authenticated app can read local data during an outage; offline reload does not bypass login. The old `bolbill` guest database is preserved and is not automatically imported into an account.
- New bills snapshot business name/address/mobile/footer. Profile edits affect new bills; old receipts keep their original details. Owner name stays private; business contact appears on receipts, customer contact does not.
- Synthetic-data reset affects only the account's local tables, not its cloud identity/profile. Development, fixtures and screenshots use synthetic data.

## Verification limits

Tests mock Supabase REST for signup/confirmation, cookies, login, refresh, logout, ownership, onboarding and gateway enforcement. Local database tests cover account isolation and receipt snapshots. This does not verify a live project, email delivery or PostgreSQL RLS execution; those require the setup above. No real account was created or verification email sent during implementation.

Primary references: [Auth REST](https://supabase.github.io/auth/), [password-based auth](https://supabase.com/docs/guides/auth/passwords), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
