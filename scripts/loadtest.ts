/**
 * Load and soak test: N simulated browsers each run M turns against a REAL gateway process,
 * which talks to the MOCK Gnani servers. It never touches the real Gnani API: the gateway is
 * started with a clean environment whose Gnani URLs point at 127.0.0.1, and the script refuses
 * to start otherwise.
 *
 *   pnpm loadtest                       # 20 clients x 50 turns
 *   pnpm loadtest --clients 4 --turns 5 # quick check
 *   pnpm loadtest --json out.json
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { speechFrame, startMockGnani } from '@bolbill/mock-gnani';
import { percentile, slope, spread, type Spread } from './loadtest/stats';

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://localhost:3000';
const METRICS_TOKEN = 'loadtest-metrics-token';
const FRAME_MS = 32;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}
const CLIENTS = Number(arg('clients', '20'));
const TURNS = Number(arg('turns', '50'));
const JSON_OUT = arg('json', '');

const HELLO = {
  type: 'hello',
  v: 1,
  clientTime: 0,
  lang: 'hi-IN',
  catalog: {
    version: 1,
    products: [
      { id: 'p1', name: 'Aata', aliases: ['atta'], unit: 'kg', pricePerUnit: 45 },
      { id: 'p2', name: 'Cheeni', aliases: ['sugar'], unit: 'kg', pricePerUnit: 50 },
      { id: 'p3', name: 'Maggi', aliases: [], unit: 'packet', pricePerUnit: 14 },
    ],
    customers: [
      { id: 'c1', name: 'Sharma ji', aliases: [], balance: 120 },
      { id: 'c2', name: 'Verma ji', aliases: [], balance: 300 },
    ],
  },
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

interface Results {
  turns: number;
  completed: number;
  interrupted: number;
  reconnects: number;
  failures: string[];
  framesSent: number;
  releaseToProcessing: number[];
  releaseToTranscript: number[];
  releaseToDraft: number[];
  releaseToFirstAudio: number[];
  gateway: Record<string, number[]>;
}

const results: Results = {
  turns: 0, completed: 0, interrupted: 0, reconnects: 0, failures: [], framesSent: 0,
  releaseToProcessing: [], releaseToTranscript: [], releaseToDraft: [], releaseToFirstAudio: [],
  gateway: {},
};

class Client {
  private ws: WebSocket | null = null;
  private waiters: ((m: Record<string, unknown> | 'bin' | 'closed') => void)[] = [];
  private queue: (Record<string, unknown> | 'bin')[] = [];
  private turnId = 0;

  constructor(private readonly base: string) {}

  private push(item: Record<string, unknown> | 'bin' | 'closed'): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item);
    else if (item !== 'closed') this.queue.push(item);
  }

  async connect(): Promise<void> {
    const res = await fetch(`${this.base}/session`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const { token } = (await res.json()) as { token: string };
    this.queue = [];
    const ws = new WebSocket(`${this.base.replace(/^http/, 'ws')}/ws?token=${token}`, { headers: { origin: ORIGIN } });
    this.ws = ws;
    ws.on('message', (data, isBinary) => (isBinary ? this.push('bin') : this.push(JSON.parse(data.toString()) as Record<string, unknown>)));
    ws.on('close', () => this.push('closed'));
    ws.on('error', () => undefined);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.send(JSON.stringify(HELLO));
    await this.until((m) => m !== 'bin' && m !== 'closed' && m['type'] === 'ready', 5000);
  }

  drop(): void {
    this.ws?.terminate();
    this.ws = null;
  }

  /** Waits for a message matching `match`; returns it with the time it arrived. */
  private async until(match: (m: Record<string, unknown> | 'bin' | 'closed') => boolean, timeoutMs: number): Promise<Record<string, unknown> | 'bin'> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      const queued = this.queue.shift();
      const item = queued ?? (await this.next(deadline - performance.now()));
      if (item === 'closed') throw new Error('socket closed');
      if (match(item)) return item;
    }
  }

  private next(ms: number): Promise<Record<string, unknown> | 'bin' | 'closed'> {
    if (ms <= 0) return Promise.reject(new Error('timeout'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== wake);
        reject(new Error('timeout'));
      }, ms);
      const wake = (m: Record<string, unknown> | 'bin' | 'closed') => {
        clearTimeout(timer);
        resolve(m);
      };
      this.waiters.push(wake);
    });
  }

  async turn(interruptAfterAudio: boolean): Promise<void> {
    const ws = this.ws;
    if (!ws) throw new Error('not connected');
    const turnId = ++this.turnId;
    const frames = 30 + Math.floor(Math.random() * 30);
    const frame = speechFrame();
    results.turns++;
    ws.send(JSON.stringify({ type: 'ptt_start', turnId }));
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      ws.send(frame);
      results.framesSent++;
      const wait = start + (i + 1) * FRAME_MS - performance.now(); // drift-corrected cadence
      if (wait > 0) await sleep(wait);
    }
    const release = performance.now();
    ws.send(JSON.stringify({ type: 'ptt_end', turnId }));

    let sawProcessing = false;
    let sawTranscript = false;
    let sawDraft = false;
    let sawAudio = false;
    for (;;) {
      const m = await this.until(() => true, 8000);
      const at = performance.now() - release;
      if (m === 'bin') {
        if (!sawAudio) {
          sawAudio = true;
          results.releaseToFirstAudio.push(at);
          if (interruptAfterAudio) {
            ws.send(JSON.stringify({ type: 'interrupt', turnId }));
            results.interrupted++;
            results.completed++;
            return;
          }
        }
        continue;
      }
      if (m['turnId'] !== undefined && m['turnId'] !== turnId) continue;
      switch (m['type']) {
        case 'processing': if (!sawProcessing) { sawProcessing = true; results.releaseToProcessing.push(at); } break;
        case 'transcript': if (!sawTranscript) { sawTranscript = true; results.releaseToTranscript.push(at); } break;
        case 'draft': if (!sawDraft) { sawDraft = true; results.releaseToDraft.push(at); } break;
        case 'timing': {
          const spans = (m['spans'] ?? {}) as Record<string, number>;
          for (const [k, v] of Object.entries(spans)) (results.gateway[k] ??= []).push(v);
          break;
        }
        case 'tts_end': if (sawDraft) { results.completed++; return; } break;
        case 'error': throw new Error(`gateway error ${String(m['code'])}`);
        default: break;
      }
    }
  }
}

async function runClient(id: number, base: string, onDone: () => void): Promise<void> {
  const client = new Client(base);
  await client.connect();
  for (let t = 0; t < TURNS; t++) {
    try {
      const interrupt = Math.random() < 0.1;
      await client.turn(interrupt);
      if (interrupt) await sleep(150);
      if (Math.random() < 0.04) {
        client.drop(); // the phone loses signal; it comes back with a new session
        results.reconnects++;
        await sleep(100 + Math.random() * 400);
        await client.connect();
      }
    } catch (error) {
      results.failures.push(`client ${id} turn ${t}: ${(error as Error).message}`);
      client.drop();
      await sleep(300);
      try { await client.connect(); } catch (e) { results.failures.push(`client ${id} reconnect: ${(e as Error).message}`); return; }
    }
  }
  client.drop();
  onDone();
}

interface Sample { t: number; rssMb: number; heapUsedMb: number; cpuPercent: number; lagP99: number; lagMax: number; sessions: number }

async function main() {
  const mock = await startMockGnani({
    stt: { transcriptLatencyMs: 120, defaultTranscript: ({ segmentIndex }) => ['Sharma ji ko do kilo aata aur ek Maggi, udhaar likh do', 'haan', 'Sharma ji ka kitna udhaar hai', 'Verma ji ne do sau de diye'][segmentIndex % 4] ?? 'haan' },
    tts: { msPerChar: 20, minAudioMs: 300 },
  });
  for (const url of [mock.stt.url, mock.tts.url]) {
    if (!/^ws:\/\/127\.0\.0\.1[:/]/.test(url)) throw new Error('refusing to run: mock URL is not local');
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const tsx = join(here, 'node_modules/.bin/tsx');
  // A clean environment: nothing from the developer's shell or .env can reach the gateway.
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    GNANI_API_KEY: 'loadtest-mock-key-not-real',
    GNANI_STT_URL: mock.stt.url,
    GNANI_TTS_URL: mock.tts.url,
    GNANI_TTS_CACHE_DIR: join(here, '../.tts-cache-loadtest'),
    LLM_PROVIDER: 'none',
    ALLOWED_ORIGINS: ORIGIN,
    SESSION_TOKEN_SECRET: 'loadtest-secret-not-for-production',
    METRICS_TOKEN,
    MAX_SESSIONS: String(Math.max(CLIENTS + 5, 10)),
    MAX_SESSION_MINUTES: '60',
    SESSION_RATE_PER_IP_PER_MIN: '100000',
    SESSION_RATE_GLOBAL_PER_MIN: '100000',
    DAILY_STT_SECONDS_CAP: '100000000',
    DAILY_TTS_CHARS_CAP: '100000000',
    PORT: String(port),
    LOG_LEVEL: 'warn',
  };
  const gateway: ChildProcess = spawn(tsx, [join(here, '../apps/gateway/src/main.ts')], { env, stdio: ['ignore', 'inherit', 'inherit'] });
  const stopGateway = () => gateway.kill('SIGTERM');
  process.on('exit', stopGateway);

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }

  const samples: Sample[] = [];
  const started = performance.now();
  const poll = async () => {
    const res = await fetch(`${base}/metrics`, { headers: { authorization: `Bearer ${METRICS_TOKEN}` } });
    const m = (await res.json()) as { activeSessions: number; runtime: { rssMb: number; heapUsedMb: number; cpuPercent: number; eventLoopDelayMs: { p99: number; max: number } } };
    samples.push({ t: (performance.now() - started) / 1000, rssMb: m.runtime.rssMb, heapUsedMb: m.runtime.heapUsedMb, cpuPercent: m.runtime.cpuPercent, lagP99: m.runtime.eventLoopDelayMs.p99, lagMax: m.runtime.eventLoopDelayMs.max, sessions: m.activeSessions });
    return m;
  };
  await poll();
  const timer = setInterval(() => void poll().catch(() => undefined), 2000);

  console.log(`load test: ${CLIENTS} clients x ${TURNS} turns against the gateway on :${port} (mock Gnani, no real API)`);
  let done = 0;
  await Promise.all(Array.from({ length: CLIENTS }, (_, i) => runClient(i, base, () => done++).catch((e: Error) => { results.failures.push(`client ${i} fatal: ${e.message}`); })));
  clearInterval(timer);
  await sleep(1500); // let the gateway notice the closes
  const finalMetrics = await poll();
  const seconds = (performance.now() - started) / 1000;

  const upstreamFrames = mock.stt.connections.reduce((s, c) => s + c.frames, 0);
  const violations = mock.stt.connections.flatMap((c) => c.violations);
  const openUpstream = mock.stt.connections.filter((c) => c.closeCode === undefined).length;

  const half = samples.filter((s) => s.t > seconds / 2);
  const growth = {
    rssMbPerMin: slope(half.map((s) => ({ x: s.t / 60, y: s.rssMb }))),
    heapMbPerMin: slope(half.map((s) => ({ x: s.t / 60, y: s.heapUsedMb }))),
  };
  // Garbage collection makes heap use a sawtooth, so a leak shows in the FLOOR (the lowest heap in
  // each 20 s window), not in a fitted line through the peaks. Skip the first fifth as warm-up.
  const buckets: { x: number; y: number }[] = [];
  for (let i = 0; i + 10 <= samples.length; i += 10) {
    const w = samples.slice(i, i + 10);
    buckets.push({ x: (w[0]?.t ?? 0) / 60, y: Math.min(...w.map((s) => s.heapUsedMb)) });
  }
  const floors = buckets.slice(Math.floor(buckets.length / 5));
  const heapFloorSlope = slope(floors);
  const cpu = samples.map((s) => s.cpuPercent);
  const report = {
    config: { clients: CLIENTS, turnsPerClient: TURNS, seconds: Math.round(seconds) },
    turns: { attempted: results.turns, completed: results.completed, interrupted: results.interrupted, reconnects: results.reconnects, failures: results.failures.length },
    frames: { clientSent: results.framesSent, mockReceived: upstreamFrames, notForwarded: results.framesSent - upstreamFrames, mockViolations: violations.length },
    spansMs: {
      releaseToProcessing: spread(results.releaseToProcessing),
      releaseToTranscript: spread(results.releaseToTranscript),
      releaseToDraft: spread(results.releaseToDraft),
      releaseToFirstAudio: spread(results.releaseToFirstAudio),
      gateway: Object.fromEntries(Object.entries(results.gateway).map(([k, v]) => [k, spread(v)])) as Record<string, Spread>,
    },
    gatewayProcess: {
      cpuPercent: { p50: percentile(cpu, 50), p95: percentile(cpu, 95), max: percentile(cpu, 100) },
      rssMb: { start: samples[0]?.rssMb, peak: Math.max(...samples.map((s) => s.rssMb)), end: samples.at(-1)?.rssMb },
      heapUsedMb: { start: samples[0]?.heapUsedMb, peak: Math.max(...samples.map((s) => s.heapUsedMb)), end: samples.at(-1)?.heapUsedMb },
      secondHalfGrowth: growth,
      heapFloorMb: floors.map((b) => Math.round(b.y * 10) / 10),
      heapFloorSlopeMbPerMin: Math.round(heapFloorSlope * 100) / 100,
      eventLoopDelayMs: { p99OfWindows: percentile(samples.map((s) => s.lagP99), 50), worstP99: percentile(samples.map((s) => s.lagP99), 100), worstMax: percentile(samples.map((s) => s.lagMax), 100) },
      peakSessions: Math.max(...samples.map((s) => s.sessions)),
    },
    verdict: {
      heapFloorSlopeUnder1MbPerMin: heapFloorSlope < 1,
      allTurnsCompleted: results.completed === results.turns && results.failures.length === 0,
      noFramesLost: results.framesSent === upstreamFrames,
      noPacingViolations: violations.length === 0,
      allSessionsClosed: finalMetrics.activeSessions === 0 && openUpstream === 0,
    },
    afterRun: { activeSessions: finalMetrics.activeSessions, openUpstreamSttConnections: openUpstream },
    series: samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 12)) === 0).map((s) => ({ t: Math.round(s.t), rssMb: s.rssMb, heapUsedMb: s.heapUsedMb, cpuPercent: s.cpuPercent, lagP99: s.lagP99, sessions: s.sessions })),
    sampleFailures: results.failures.slice(0, 5),
  };
  console.log(JSON.stringify(report, null, 2));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

  stopGateway();
  await mock.close();
  const bad = results.failures.length > 0 || violations.length > 0 || finalMetrics.activeSessions !== 0;
  process.exit(bad ? 1 : 0);
}

void main();
