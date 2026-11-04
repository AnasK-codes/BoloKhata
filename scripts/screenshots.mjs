/* global setTimeout, fetch, WebSocket, Buffer, console */
// Captures the main UI states into docs/screens/ with headless Chrome (no extra dependencies:
// Chrome DevTools Protocol over Node's built-in WebSocket). Run it against the MOCK stack, in
// development mode so `?tone=1` is available (the synthetic-tone banner is visible in every
// shot, by design: nothing here is a real voice):
//
//   pnpm dev:mock                     # mock Gnani + gateway + web on :3000
//   node scripts/screenshots.mjs --size 360x800 --scheme dark --out docs/screens/360x800-dark
//
// The mock server cycles its scripted transcripts, so restart `pnpm dev:mock` before each run.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const [W, H] = arg('size', '360x800').split('x').map(Number);
const SCHEME = arg('scheme', 'dark');
const OUT = arg('out', `docs/screens/${W}x${H}-${SCHEME}`);
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const BASE = arg('base', 'http://localhost:3000');
const PORT = 9333;
mkdirSync(OUT, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'bb-shot-'))}`, '--no-first-run', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(200); }
}
if (!target) throw new Error('Chrome did not start');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64')); console.log('saved', name); };
const rectOf = (sel) => evaluate(`(() => { const e = ${sel}; if (!e) return null; e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2}; })()`);
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mouseReleased' ? 0 : 1 });
const click = async (sel) => { const p = await rectOf(sel); if (!p) throw new Error(`not found: ${sel}`); await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y); };
const byText = (t) => `[...document.querySelectorAll('button,a')].find((b) => b.textContent.includes(${JSON.stringify(t)}))`;
const MIC = `document.querySelector('button[aria-label^="Microphone"]')`;
const go = async (path) => { await send('Page.navigate', { url: `${BASE}${path}` }); await sleep(1500); };
const text = () => evaluate('document.querySelector("main")?.innerText ?? ""');

async function talk(ms) { // hold-to-talk for `ms`, return after release
  const p = await rectOf(MIC); await mouse('mousePressed', p.x, p.y); await sleep(ms); return { p, release: () => mouse('mouseReleased', p.x, p.y) };
}

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: SCHEME }] });

await go('/?tone=1');
await shot('01-voice-first-open');
await click(byText('Mic chalu karo')); await sleep(1500);
await shot('02-voice-idle');

let t = await talk(1800); await shot('03-listening'); await t.release(); await sleep(250); await shot('04-processing');
for (let i = 0; i < 40 && !(await text()).includes('Confirm'); i++) await sleep(250);
await sleep(600); await shot('05-bill-speaking'); // the voice is reading it back
await evaluate('window.scrollTo(0, document.body.scrollHeight)'); await sleep(300); await shot('06-bill-totals');
await evaluate('window.scrollTo(0, 0)');

// Barge-in: press while speaking, then let go.
t = await talk(900); await shot('07-interrupt'); await t.release(); await sleep(2500);
await shot('08-after-second-turn');

t = await talk(1500); await t.release();
for (let i = 0; i < 40 && !(await text()).includes('Balance') && !(await text()).includes('udhaar baaki'); i++) await sleep(250);
await sleep(800); await shot('09-balance-or-answer');

await click(byText('Latency')).catch(() => undefined);
await go('/settings'); await shot('10-settings');
await evaluate(`document.querySelector('input[role=switch]').click()`); await sleep(300);
await go('/?tone=1'); await sleep(800);
await click(byText('Mic chalu karo')).catch(() => undefined); await sleep(1200);
t = await talk(1500); await t.release(); await sleep(3500); await shot('11-latency-hud');

await go('/ledger'); await shot('12-ledger');
await click(`[...document.querySelectorAll('main li button')][0]`); await sleep(600); await shot('13-ledger-statement');
await go('/catalog'); await shot('14-catalog');
await click(byText('Naya')); await sleep(400); await click(`document.querySelector('button[type=submit]')`); await sleep(300); await shot('15-catalog-validation');

await send('Network.enable');
await go('/?tone=1'); await sleep(800);
await click(byText('Mic chalu karo')).catch(() => undefined); await sleep(1200);
await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
await evaluate('window.dispatchEvent(new Event("offline"))'); await sleep(600); await shot('16-offline');

ws.close(); chrome.kill();
