import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { businessProfileSchema } from '@bolbill/shared';
import { credentialsSchema, signupSchema } from './schema';
import { AccountError, authConfig, supabase, type AuthSession } from './supabase';

const ACCESS = 'bolbill-access';
const REFRESH = 'bolbill-refresh';
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, path: '/', secure: process.env.NODE_ENV === 'production' };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store, private', 'Vary': 'Cookie' } });
function setSession(response: NextResponse, session: AuthSession) {
  response.cookies.set(ACCESS, session.access_token, { ...cookieOptions, maxAge: session.expires_in });
  response.cookies.set(REFRESH, session.refresh_token, { ...cookieOptions, maxAge: 30 * 24 * 3600 });
}
function clearSession(response: NextResponse) {
  response.cookies.set(ACCESS, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH, '', { ...cookieOptions, maxAge: 0 });
}

/** Bound the body even if Content-Length is absent or forged. */
async function body(request: NextRequest): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AccountError(415, 'JSON request chahiye.');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let text = ''; let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > 8192) { await reader.cancel(); throw new AccountError(413, 'Request bahut badi hai.'); }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  try { return JSON.parse(text) as unknown; } catch { throw new AccountError(400, 'Request valid nahi hai.'); }
}

export async function handleAccount(request: NextRequest, action = 'current', fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<NextResponse> {
  let rotated: AuthSession | undefined;
  const finish = (response: NextResponse) => { if (rotated) setSession(response, rotated); return response; };
  try {
    // The canonical public origin is explicit behind a reverse proxy; never trust forwarded
    // headers supplied by a caller to decide which cross-origin mutations are allowed.
    const originConfig = z.url().safeParse(env.APP_ORIGIN ?? request.nextUrl.origin);
    if (!originConfig.success || !/^https?:/.test(originConfig.data)) throw new AccountError(503, 'APP_ORIGIN configuration valid nahi hai.');
    const appOrigin = new URL(originConfig.data).origin;
    if (request.method !== 'GET') {
      if (request.headers.get('origin') !== appOrigin) throw new AccountError(403, 'Request origin allowed nahi hai.');
    }
    const client = supabase(authConfig(env), fetcher);
    if (action === 'login' || action === 'signup') {
      const parsed = (action === 'signup' ? signupSchema : credentialsSchema).safeParse(await body(request));
      if (!parsed.success) throw new AccountError(400, action === 'signup' ? 'Valid email aur 8–128 characters ka password do.' : 'Email aur password do.');
      const session = action === 'signup' ? await client.signup(parsed.data) : await client.login(parsed.data);
      if (!session) { const response = json({ configured: true, user: null, profile: null, confirmationRequired: true }); clearSession(response); return response; }
      // A successful login must survive a temporarily unavailable profile table.
      rotated = session;
      const profile = await client.profile(session.access_token, session.user.id);
      return finish(json({ configured: true, user: session.user, profile }));
    }

    let access = request.cookies.get(ACCESS)?.value;
    const refresh = request.cookies.get(REFRESH)?.value;
    if (action === 'logout') {
      if (access) await client.logout(access).catch(() => undefined);
      const response = json({ configured: true, user: null, profile: null }); clearSession(response); return response;
    }
    let user;
    if (access) {
      try { user = await client.user(access); }
      catch (error) { if (!(error instanceof AccountError) || error.status !== 401) throw error; }
    }
    if (!user && refresh) {
      try { rotated = await client.refresh(refresh); access = rotated.access_token; user = await client.user(access); }
      catch (error) {
        if (!(error instanceof AccountError) || error.status !== 401) throw error;
        const response = json({ configured: true, user: null, profile: null }, action === 'current' ? 200 : 401); clearSession(response); return response;
      }
    }
    if (!user || !access) return json({ configured: true, user: null, profile: null }, action === 'current' ? 200 : 401);
    if (action === 'profile') {
      const parsed = businessProfileSchema.safeParse(await body(request));
      if (!parsed.success) throw new AccountError(400, 'Business name, owner, mobile aur address sahi bharo.');
      const profile = await client.saveProfile(access, user.id, parsed.data);
      return finish(json({ configured: true, user, profile }));
    }
    const profile = await client.profile(access, user.id);
    if (action === 'gateway-session') {
      if (!profile) throw new AccountError(403, 'Pehle business profile complete karo.');
      const parsed = z.object({ accessCode: z.string().max(128).optional() }).safeParse(await body(request));
      if (!parsed.success) throw new AccountError(400, 'Demo code valid nahi hai.');
      const gatewayUrl = env.GATEWAY_INTERNAL_URL ?? env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080';
      let upstream: Response;
      try {
        upstream = await fetcher(`${gatewayUrl.replace(/\/$/, '')}/session`, {
          method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(8000),
          headers: { 'content-type': 'application/json', origin: appOrigin, authorization: `Bearer ${access}` }, body: JSON.stringify(parsed.data),
        });
      } catch { throw new AccountError(503, 'Voice gateway se connection nahi hua. Dobara try karo.'); }
      const raw: unknown = await upstream.json().catch(() => null);
      // This user's token was just verified above; an upstream rejection is a gateway setup
      // mismatch, not a reason to repeatedly unmount/reopen the user's account and microphone.
      if (upstream.status === 401) throw new AccountError(503, 'Voice gateway ka account setup web app se match nahi karta. Supabase settings check karo.');
      const allowed = z.union([
        z.object({ token: z.string().min(1).max(4096), expiresAt: z.number().optional() }),
        z.object({ type: z.literal('limit'), reason: z.string(), message: z.string().max(200), retryAfterSec: z.number().optional(), resetAt: z.string().optional() }),
        z.object({ error: z.string().max(100) }),
      ]).safeParse(raw);
      if (!allowed.success) throw new AccountError(502, 'Voice gateway ka jawab valid nahi tha.');
      return finish(json(allowed.data, upstream.status));
    }
    if (action !== 'current') throw new AccountError(404, 'Action nahi mila.');
    return finish(json({ configured: true, user, profile }));
  } catch (error) {
    if (error instanceof AccountError) {
      const missingConfig = !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY;
      return finish(json({ error: error.message, ...(missingConfig ? { configured: false, user: null, profile: null } : {}) }, error.status));
    }
    return finish(json({ error: 'Account request complete nahi hui. Dobara try karo.' }, 500));
  }
}
