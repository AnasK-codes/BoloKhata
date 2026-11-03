import { setTimeout as delay } from 'node:timers/promises';
import { pickSubset, type Clip } from './clips';
import { STT_VARIANTS, runClipOnFreshConnection } from './expB';
import { DOCS_DEFAULT_VAD, SttSession, streamUtterance, type UtteranceResult } from './sttClient';
import { formatNumber, formatSummary, summarize } from './stats';
import type { ExperimentContext, ExperimentResult } from './types';

const PAUSE_BETWEEN_UTTERANCES_MS = 1500;
const MAX_IDLE_TIMEOUT_SEC = 900;

const baselineConfig = (ctx: ExperimentContext) => ({
  url: ctx.env.sttUrl,
  apiKey: ctx.apiKey,
  model: 'prisma-v3.0' as const,
  language: 'indic-auto',
  format: 'verbatim' as const,
  vad: DOCS_DEFAULT_VAD,
});

function describe(result: UtteranceResult): string[] {
  return [
    formatNumber(result.commitToTranscriptMs),
    result.transcripts.map((t) => t.segmentIndex ?? '?').join(','),
    result.transcripts.map((t) => t.segmentId ?? '?').join(','),
    String(result.transcripts.filter((t) => t.text !== '').length),
  ];
}

/** Waits `seconds` but returns early (with the close info) if Gnani drops the socket. */
async function idleWait(session: SttSession, seconds: number, ctx: ExperimentContext): Promise<number> {
  const started = Date.now();
  while ((Date.now() - started) / 1000 < seconds && !session.closeInfo) {
    await delay(1000);
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (elapsed % 30 === 0) ctx.log(`    idle ${elapsed}/${seconds} s`);
  }
  return (Date.now() - started) / 1000;
}

/** Experiment C: one socket for many utterances versus a fresh socket each time, plus idle gaps. */
export async function runExperimentC(ctx: ExperimentContext): Promise<ExperimentResult> {
  const allClips = ctx.clips?.clips;
  if (!allClips) throw new Error('Experiment C needs clips');
  const clips = pickSubset(allClips, 3);
  const notes: string[] = [];
  const data: Record<string, unknown> = {};
  const baseline = STT_VARIANTS[0];
  if (!baseline) throw new Error('baseline variant missing');

  // --- C1: three utterances on one socket ---
  const reuseRows: string[][] = [];
  const reuseLatencies: number[] = [];
  const reuseNeed = clips.reduce((s, c) => s + c.seconds, 0);
  if (ctx.budget.canSpendAudio(reuseNeed)) {
    ctx.log('  C reuse: 3 utterances on one socket');
    const session = await SttSession.open({ ...baselineConfig(ctx), idleTimeoutSec: 60 });
    const results: UtteranceResult[] = [];
    try {
      for (const [i, clip] of clips.entries()) {
        const result = await streamUtterance(session, clip.pcm, baseline.pace);
        ctx.budget.spendAudio('C', result.audioSeconds);
        results.push(result);
        reuseRows.push([`${i + 1}`, clip.id, ...describe(result)]);
        if (result.commitToTranscriptMs !== null) reuseLatencies.push(result.commitToTranscriptMs);
        await delay(PAUSE_BETWEEN_UTTERANCES_MS);
      }
    } finally {
      ctx.budget.spendConnection('C', (performance.now() - session.openedAt) / 1000);
      await session.close();
    }
    const indices = results.flatMap((r) => r.transcripts.map((t) => t.segmentIndex));
    const ascending = indices.every((v, i) => v !== null && (i === 0 || v > (indices[i - 1] ?? 0)));
    notes.push(
      `On the shared socket, segment indices were ${ascending ? 'strictly increasing' : 'NOT strictly increasing'}: [${indices.join(', ')}].`,
    );
    data['reuse'] = results;
  } else {
    notes.push('Skipped C1 (socket reuse): not enough audio budget.');
  }

  // --- C2: a fresh socket per utterance, same clips ---
  const freshRows: string[][] = [];
  const freshLatencies: number[] = [];
  const freshConnect: number[] = [];
  for (const [i, clip] of clips.entries()) {
    ctx.log(`  C fresh: ${clip.id}`);
    try {
      const run = await runClipOnFreshConnection(ctx, 'C', baseline, clip, 1);
      if (!run) {
        notes.push(`Skipped fresh-connection run for ${clip.id}: not enough audio budget.`);
        continue;
      }
      freshRows.push([`${i + 1}`, clip.id, formatNumber(run.connectedMs), ...describe(run.result)]);
      freshConnect.push(run.connectedMs);
      if (run.result.commitToTranscriptMs !== null) freshLatencies.push(run.result.commitToTranscriptMs);
    } catch (error) {
      notes.push(`Fresh run for ${clip.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // --- C3: idle gaps on one socket ---
  const idleRows: string[][] = [];
  const shortest = [...allClips].sort((a, b) => a.seconds - b.seconds)[0];
  const gaps = ctx.args.skipLongIdle ? [60] : [60, 300];
  if (shortest && ctx.budget.canSpendAudio(shortest.seconds * (gaps.length + 1))) {
    ctx.log(`  C idle: one socket, gaps of ${gaps.join(' s and ')} s (wall-clock time)`);
    const session = await SttSession.open({ ...baselineConfig(ctx), idleTimeoutSec: MAX_IDLE_TIMEOUT_SEC });
    try {
      idleRows.push(await idleStep(ctx, session, shortest, 'first utterance', 0));
      for (const gap of gaps) {
        const waited = await idleWait(session, gap, ctx);
        if (session.closeInfo) {
          idleRows.push([`after ${gap} s idle`, 'socket CLOSED by server', `${waited.toFixed(0)} s`, `${session.closeInfo.code} ${session.closeInfo.reason}`, '-']);
          break;
        }
        idleRows.push(await idleStep(ctx, session, shortest, `after ${gap} s idle`, gap));
      }
    } finally {
      ctx.budget.spendConnection('C', (performance.now() - session.openedAt) / 1000);
      await session.close();
    }
  } else {
    notes.push('Skipped C3 (idle gaps): not enough audio budget.');
  }

  const suggestions: string[] = [];
  const reuse = summarize(reuseLatencies);
  const fresh = summarize(freshLatencies);
  const connect = summarize(freshConnect);
  if (reuse && fresh && connect) {
    suggestions.push(
      `reuse strategy: reused-socket commit→transcript median ${reuse.median.toFixed(0)} ms vs ${fresh.median.toFixed(0)} ms on fresh sockets; a fresh socket also costs a median ${connect.median.toFixed(0)} ms to connect (only paid if connecting at press time, not if opened in advance). n=${reuse.n}/${fresh.n}, so treat as indicative.`,
    );
  }

  return {
    id: 'C',
    title: 'C. STT connection reuse and idle gaps',
    tables: [
      {
        title: 'Three utterances on ONE socket',
        headers: ['#', 'clip', 'commit→transcript (ms)', 'segment_index', 'segment_id', 'non-empty transcripts'],
        rows: reuseRows,
      },
      {
        title: 'Same clips, a FRESH socket each',
        headers: ['#', 'clip', 'connect (ms)', 'commit→transcript (ms)', 'segment_index', 'segment_id', 'non-empty transcripts'],
        rows: freshRows,
      },
      {
        title: 'Idle gaps on one socket (x-idle-timeout-sec=900)',
        headers: ['step', 'result', 'waited', 'close / commit→transcript (ms)', 'segment_index'],
        rows: idleRows,
      },
      {
        title: 'Summary',
        headers: ['strategy', 'n', 'commit→transcript median (min-max)'],
        rows: [
          ['one socket', String(reuse?.n ?? 0), formatSummary(reuse)],
          ['fresh socket', String(fresh?.n ?? 0), formatSummary(fresh)],
        ],
      },
    ],
    notes: [
      ...notes,
      'Idle time keeps a connection open but sends no audio; whether Gnani bills open-connection time is NOT documented. Check the dashboard before and after this run.',
    ],
    data,
    suggestions,
  };
}

async function idleStep(
  ctx: ExperimentContext,
  session: SttSession,
  clip: Clip,
  label: string,
  gap: number,
): Promise<string[]> {
  const result = await streamUtterance(session, clip.pcm, STT_VARIANTS[0]?.pace ?? { preRollMs: 0, drainMs: 0 });
  ctx.budget.spendAudio('C', result.audioSeconds);
  const ok = result.commitToTranscriptMs !== null;
  return [
    label,
    ok ? 'transcript received' : 'NO transcript',
    `${gap} s`,
    formatNumber(result.commitToTranscriptMs),
    result.transcripts.map((t) => t.segmentIndex ?? '?').join(','),
  ];
}
