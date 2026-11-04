/**
 * Measures how far this machine is from the Gnani API host, so regions can be compared with real
 * numbers (we do not know where Gnani hosts its API). Run it from your laptop, then from the
 * EC2 instance, then from an instance in another region:
 *
 *   pnpm measure-rtt --label ec2-mumbai
 *   pnpm measure-rtt --host api.vachana.ai --samples 15 --json out.json
 *
 * Per sample it times DNS lookup, TCP connect, TLS handshake and the first byte of an
 * unauthenticated HTTPS request (GET /). It sends NO API key, uses NO credits, and never opens
 * a Gnani session. TCP connect is the best proxy for network distance: one round trip.
 */
import { lookup } from 'node:dns/promises';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import process from 'node:process';
import tls from 'node:tls';
import { percentile } from './loadtest/stats';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const HOST = arg('host', 'api.vachana.ai');
const SAMPLES = Math.max(1, Number(arg('samples', '10')));
const LABEL = arg('label', 'unlabelled');
const JSON_OUT = arg('json', '');
const TIMEOUT_MS = 8000;

export interface Sample {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  firstByteMs: number | null;
  address: string;
}

const now = () => performance.now();

async function once(host: string): Promise<Sample> {
  const t0 = now();
  const { address, family } = await lookup(host, { family: 4 });
  const dnsMs = now() - t0;

  const t1 = now();
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const s = net.connect({ host: address, port: 443, family });
    s.setTimeout(TIMEOUT_MS, () => s.destroy(new Error('tcp timeout')));
    s.once('connect', () => resolve(s));
    s.once('error', reject);
  });
  const tcpMs = now() - t1;

  const t2 = now();
  const secure = await new Promise<tls.TLSSocket>((resolve, reject) => {
    const s = tls.connect({ socket, servername: host });
    s.once('secureConnect', () => resolve(s));
    s.once('error', reject);
  });
  const tlsMs = now() - t2;

  const t3 = now();
  const firstByteMs = await new Promise<number | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), TIMEOUT_MS);
    secure.once('data', () => {
      clearTimeout(timer);
      resolve(now() - t3);
    });
    secure.once('error', () => resolve(null));
    secure.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: bolbill-measure-rtt\r\n\r\n`);
  });
  secure.destroy();
  return { dnsMs, tcpMs, tlsMs, firstByteMs, address };
}

const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

async function main() {
  console.log(`measuring ${HOST} from "${LABEL}" (${SAMPLES} samples, no API key, no credits)`);
  const samples: Sample[] = [];
  let failures = 0;
  for (let i = 0; i < SAMPLES; i++) {
    try {
      samples.push(await once(HOST));
    } catch (error) {
      failures++;
      console.log(`  sample ${i + 1} failed: ${(error as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  const col = (pick: (s: Sample) => number | null) => samples.map(pick).filter((v): v is number => v !== null);
  const summary = (values: number[]) => ({ p50: round(percentile(values, 50)), p95: round(percentile(values, 95)), min: round(values.length ? Math.min(...values) : null) });
  const report = {
    label: LABEL,
    host: HOST,
    at: new Date().toISOString(),
    addresses: [...new Set(samples.map((s) => s.address))],
    samples: samples.length,
    failures,
    dnsMs: summary(col((s) => s.dnsMs)),
    tcpConnectMs: summary(col((s) => s.tcpMs)),
    tlsHandshakeMs: summary(col((s) => s.tlsMs)),
    firstByteMs: summary(col((s) => s.firstByteMs)),
    note: 'tcpConnectMs is about one network round trip. Compare it across labels (laptop, ec2-mumbai, ...). Run from the place the gateway will run.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  process.exit(samples.length === 0 ? 1 : 0);
}

void main();
