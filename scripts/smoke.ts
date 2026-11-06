/**
 * Server-side smoke test for a running stack (local mock compose or the deployed app). Sends no
 * audio and calls no Gnani or LLM API: it only opens and closes a session.
 *
 *   pnpm smoke --url https://your.domain
 *   pnpm smoke --url http://127.0.0.1:8080 --origin http://localhost:3000
 *
 * Checks /healthz, that a foreign origin, a bad token and an oversize message are refused, and that
 * a valid token opens a WebSocket that answers `hello` with `ready`. With account auth on, POST
 * /session needs a signed-in user: pass a Supabase access token in SMOKE_BEARER (never commit it),
 * or the token checks are reported as skipped. Exit code 1 if any check fails.
 */
import process from 'node:process';
import WebSocket from 'ws';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const BASE = arg('url', 'http://127.0.0.1:8080').replace(/\/$/, '');
const ORIGIN = arg('origin', BASE);
const ACCESS_CODE = process.env['SMOKE_ACCESS_CODE'];
const BEARER = process.env['SMOKE_BEARER'];
const WS_BASE = BASE.replace(/^http/, 'ws');
const HELLO = { type: 'hello', v: 2, clientTime: 0, lang: 'hi-IN', catalog: { version: 1, products: [], customers: [] } };

let failed = 0;
const report = (ok: boolean | 'skip', name: string, detail = '') => {
  if (ok === false) failed++;
  console.log(`${ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

async function postSession(origin: string): Promise<Response> {
  return fetch(`${BASE}/session`, {
    method: 'POST',
    headers: {
      origin,
      'content-type': 'application/json',
      ...(BEARER ? { authorization: `Bearer ${BEARER}` } : {}),
    },
    body: JSON.stringify(ACCESS_CODE ? { accessCode: ACCESS_CODE } : {}),
  });
}

/** Resolves with the HTTP status of a refused upgrade, or 101 when the socket opened. */
function open(url: string, origin: string): Promise<{ status: number; ws?: WebSocket }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers: { origin } });
    ws.once('open', () => resolve({ status: 101, ws }));
    ws.once('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.once('error', () => resolve({ status: 0 }));
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 5000): Promise<{ type?: string; code?: number }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({}), timeoutMs);
    ws.once('message', (data) => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(data.toString()) as { type?: string });
      } catch {
        resolve({});
      }
    });
    ws.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code });
    });
  });
}

async function token(): Promise<string | null> {
  const res = await postSession(ORIGIN);
  if (res.status === 401 && !BEARER) return null;
  const body = (await res.json().catch(() => ({}))) as { token?: string };
  return typeof body.token === 'string' ? body.token : null;
}

async function main() {
  console.log(`smoke test against ${BASE} (origin ${ORIGIN})`);
  const health = await fetch(`${BASE}/healthz`).catch(() => null);
  const healthBody = (await health?.json().catch(() => null)) as { ok?: boolean } | null;
  report(health?.status === 200 && healthBody?.ok === true, 'GET /healthz', `status ${health?.status ?? 'no answer'}`);

  const foreign = await postSession('https://evil.example');
  report(foreign.status === 403, 'POST /session refuses a foreign origin', `status ${foreign.status}`);

  const badToken = await open(`${WS_BASE}/ws?token=not.a.token`, ORIGIN);
  report(badToken.status === 401, 'WebSocket refuses a bad token', `status ${badToken.status}`);

  const first = await token();
  if (first === null) {
    report('skip', 'token checks', 'POST /session needs a signed-in user: set SMOKE_BEARER');
  } else {
    const wrongOrigin = await open(`${WS_BASE}/ws?token=${first}`, 'https://evil.example');
    report(wrongOrigin.status === 403, 'WebSocket refuses a foreign origin', `status ${wrongOrigin.status}`);

    const good = await token();
    const session = good ? await open(`${WS_BASE}/ws?token=${good}`, ORIGIN) : { status: 0 };
    report(session.status === 101, 'WebSocket opens with a valid token', `status ${session.status}`);
    if (session.ws) {
      const ws = session.ws;
      const replay = await open(`${WS_BASE}/ws?token=${good}`, ORIGIN);
      report(replay.status === 401, 'a token works only once', `status ${replay.status}`);
      ws.send(JSON.stringify(HELLO));
      const ready = await nextMessage(ws);
      report(ready.type === 'ready', 'hello is answered with ready', ready.type ?? `close ${ready.code ?? 'timeout'}`);
      ws.send(JSON.stringify({ type: 'ping', t: 'x'.repeat(300 * 1024) }));
      const oversize = await nextMessage(ws);
      report(oversize.code === 1009 || oversize.type === 'error', 'an oversize message is refused', oversize.type ?? `close ${oversize.code ?? 'timeout'}`);
      ws.terminate();
    }
  }
  console.log(failed === 0 ? 'smoke: all checks passed' : `smoke: ${failed} check(s) FAILED`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
