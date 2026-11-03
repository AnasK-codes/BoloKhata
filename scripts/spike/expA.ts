import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import tls from 'node:tls';
import { DOCS_DEFAULT_VAD, SttSession } from './sttClient';
import { TtsSession } from './ttsClient';
import { formatSummary, summarize } from './stats';
import type { ExperimentContext, ExperimentResult } from './types';

const REPEATS = 5;

interface Sample {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number | null;
  upgradeMs: number;
  /** Upgrade plus Gnani's `connected` message (STT only). */
  readyMs: number | null;
}

function timeConnect(host: string, port: number, secure: boolean): Promise<{ tcpMs: number; tlsMs: number | null }> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    let tcpDone = 0;
    const socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
    socket.once('connect', () => {
      tcpDone = performance.now();
      if (!secure) {
        socket.destroy();
        resolve({ tcpMs: tcpDone - started, tlsMs: null });
      }
    });
    socket.once('secureConnect', () => {
      socket.destroy();
      resolve({ tcpMs: tcpDone - started, tlsMs: performance.now() - tcpDone });
    });
    socket.once('error', reject);
  });
}

async function sampleOnce(target: 'stt' | 'tts', url: string, ctx: ExperimentContext): Promise<Sample> {
  const parsed = new URL(url);
  const secure = parsed.protocol === 'wss:';
  const port = parsed.port ? Number(parsed.port) : secure ? 443 : 80;

  const dnsStart = performance.now();
  await lookup(parsed.hostname);
  const dnsMs = performance.now() - dnsStart;
  const { tcpMs, tlsMs } = await timeConnect(parsed.hostname, port, secure);

  if (target === 'stt') {
    const session = await SttSession.open({
      url,
      apiKey: ctx.apiKey,
      model: 'prisma-v3.0',
      language: 'indic-auto',
      format: 'verbatim',
      vad: DOCS_DEFAULT_VAD,
    });
    const sample = { dnsMs, tcpMs, tlsMs, upgradeMs: session.upgradeMs, readyMs: session.connectedMs };
    await session.close();
    return sample;
  }
  const session = await TtsSession.open(url, ctx.apiKey);
  const sample = { dnsMs, tcpMs, tlsMs, upgradeMs: session.openMs, readyMs: null };
  await session.close();
  return sample;
}

/** Experiment A: what a fresh connection costs, step by step. Spends no audio or characters. */
export async function runExperimentA(ctx: ExperimentContext): Promise<ExperimentResult> {
  const rows: string[][] = [];
  const data: Record<string, Sample[]> = {};
  const notes: string[] = [
    'DNS uses the OS resolver (`dns.lookup`), so repeats 2-5 may be served from a local cache.',
    'The upgrade time includes TCP and TLS for the WebSocket itself (a separate connection from the TCP/TLS probes above it).',
  ];

  for (const [target, url] of [
    ['stt', ctx.env.sttUrl],
    ['tts', ctx.env.ttsUrl],
  ] as const) {
    const samples: Sample[] = [];
    for (let i = 0; i < REPEATS; i++) {
      try {
        samples.push(await sampleOnce(target, url, ctx));
      } catch (error) {
        notes.push(`${target} repeat ${i + 1} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    data[target] = samples;
    const col = (pick: (s: Sample) => number | null) =>
      formatSummary(summarize(samples.map(pick).filter((v): v is number => v !== null)), 0);
    rows.push([
      target.toUpperCase(),
      String(samples.length),
      col((s) => s.dnsMs),
      col((s) => s.tcpMs),
      col((s) => s.tlsMs),
      col((s) => s.upgradeMs),
      col((s) => s.readyMs),
    ]);
  }

  return {
    id: 'A',
    title: 'A. Connection costs',
    tables: [
      {
        title: 'Connection steps in ms, median (min-max)',
        headers: ['endpoint', 'runs', 'DNS', 'TCP', 'TLS', 'WebSocket upgrade', 'upgrade + `connected`'],
        rows,
      },
    ],
    notes,
    data,
    suggestions: [],
  };
}
