import type { Clip } from './clips';
import { pickSubset } from './clips';
import type { PaceOptions } from './pacer';
import {
  SttSession,
  streamUtterance,
  type SttConfig,
  type UtteranceResult,
  type VadConfig,
} from './sttClient';
import { formatNumber, formatSummary, keytermHits, summarize, wordErrorRate } from './stats';
import type { ExperimentContext, ExperimentResult } from './types';

export interface SttVariant {
  id: string;
  /** What differs from the baseline. */
  change: string;
  format: SttConfig['format'];
  language: string;
  keyterms: boolean;
  /** undefined = send no VAD headers (Gnani's documented defaults). */
  vad: VadConfig | undefined;
  pace: PaceOptions;
}

const STRICT: PaceOptions = { preRollMs: 0, drainMs: 0 };

// These two VAD presets are OUR experiment inputs, not Gnani recommendations.
const VAD_CLEAN: VadConfig = { threshold: 0.6, minSilenceMs: 300, minSpeechMs: 100, minSegmentMs: 120 };
const VAD_NOISY: VadConfig = { threshold: 0.85, minSilenceMs: 600, minSpeechMs: 200, minSegmentMs: 120 };

const BASELINE: SttVariant = {
  id: 'baseline',
  change: 'verbatim, indic-auto, no keyterms, default VAD, strict real-time pacing',
  format: 'verbatim',
  language: 'indic-auto',
  keyterms: false,
  vad: undefined,
  pace: STRICT,
};

/** One factor changes per variant, in priority order (later ones are skipped first when the budget runs out). */
export const STT_VARIANTS: SttVariant[] = [
  BASELINE,
  { ...BASELINE, id: 'fmt_transcribe', change: 'format=transcribe', format: 'transcribe' },
  { ...BASELINE, id: 'fmt_codemix', change: 'format=codemix', format: 'codemix' },
  { ...BASELINE, id: 'fmt_transliterate', change: 'format=transliterate', format: 'transliterate' },
  { ...BASELINE, id: 'lang_hi_en', change: 'language_code=hi-IN,en-IN', language: 'hi-IN,en-IN' },
  { ...BASELINE, id: 'keyterms_on', change: 'keyterms header on', keyterms: true },
  { ...BASELINE, id: 'vad_clean', change: 'VAD clean preset (thr 0.6, silence 300 ms)', vad: VAD_CLEAN },
  { ...BASELINE, id: 'vad_noisy', change: 'VAD noisy preset (thr 0.85, speech 200 ms, silence 600 ms)', vad: VAD_NOISY },
  { ...BASELINE, id: 'preroll_150', change: '150 ms pre-roll burst', pace: { preRollMs: 150, drainMs: 0 } },
  { ...BASELINE, id: 'drain_300', change: 'last 300 ms sent without pacing', pace: { preRollMs: 0, drainMs: 300 } },
];

export interface ClipRun {
  variant: string;
  clipId: string;
  noisy: boolean;
  repeat: number;
  connectedMs: number;
  result: UtteranceResult;
  wer: number | null;
  keytermExpected: number;
  keytermHit: number;
}

function configFor(variant: SttVariant, ctx: ExperimentContext, keyterms: string[]): SttConfig {
  const config: SttConfig = {
    url: ctx.env.sttUrl,
    apiKey: ctx.apiKey,
    model: 'prisma-v3.0',
    language: variant.language,
    format: variant.format,
  };
  if (variant.keyterms) config.keyterms = keyterms;
  if (variant.vad) config.vad = variant.vad;
  return config;
}

/** One fresh connection per clip, so every run pays and reports its own connect cost. */
export async function runClipOnFreshConnection(
  ctx: ExperimentContext,
  experiment: string,
  variant: SttVariant,
  clip: Clip,
  repeat: number,
): Promise<ClipRun | null> {
  if (!ctx.budget.canSpendAudio(clip.seconds)) return null;
  const keyterms = ctx.clips?.keyterms ?? [];
  const session = await SttSession.open(configFor(variant, ctx, keyterms));
  let result: UtteranceResult;
  try {
    result = await streamUtterance(session, clip.pcm, variant.pace);
  } finally {
    ctx.budget.spendConnection(experiment, (performance.now() - session.openedAt) / 1000);
    await session.close();
  }
  ctx.budget.spendAudio(experiment, result.audioSeconds);
  const hits = variant.keyterms ? keytermHits(keyterms, clip.text, result.text) : { expected: 0, hit: 0 };
  return {
    variant: variant.id,
    clipId: clip.id,
    noisy: clip.noisy,
    repeat,
    connectedMs: session.connectedMs,
    result,
    wer: wordErrorRate(clip.text, result.text),
    keytermExpected: hits.expected,
    keytermHit: hits.hit,
  };
}

const mean = (values: number[]) => summarize(values)?.mean ?? null;

function rowFor(variant: SttVariant, runs: ClipRun[]): string[] {
  const num = (pick: (r: ClipRun) => number | null) =>
    runs.map(pick).filter((v): v is number => v !== null);
  const werNoisy = num((r) => (r.noisy ? r.wer : null));
  const werQuiet = num((r) => (r.noisy ? null : r.wer));
  const expected = runs.reduce((s, r) => s + r.keytermExpected, 0);
  const hit = runs.reduce((s, r) => s + r.keytermHit, 0);
  return [
    variant.id,
    String(runs.length),
    formatSummary(summarize(num((r) => r.result.commitToProcessingMs))),
    formatSummary(summarize(num((r) => r.result.commitToTranscriptMs))),
    formatSummary(summarize(num((r) => r.result.reportedLatencyMs))),
    formatSummary(summarize(num((r) => r.result.streamMs + (r.result.commitToTranscriptMs ?? NaN)))),
    formatNumber(mean(num((r) => r.wer)), 2),
    `${formatNumber(mean(werQuiet), 2)} / ${formatNumber(mean(werNoisy), 2)}`,
    variant.keyterms ? (expected > 0 ? `${hit}/${expected}` : 'n/a') : '-',
    String(runs.filter((r) => r.result.vadClosedFirst).length),
    String(runs.filter((r) => r.result.commitToTranscriptMs === null && !r.result.vadClosedFirst).length),
    formatNumber(Math.max(0, ...runs.map((r) => r.result.maxLateMs)), 0),
  ];
}

export async function runExperimentB(ctx: ExperimentContext): Promise<ExperimentResult> {
  const clips = ctx.clips?.clips;
  if (!clips) throw new Error('Experiment B needs clips');
  const subset = pickSubset(clips, ctx.args.subset);
  const runs: ClipRun[] = [];
  const rows: string[][] = [];
  const deltaRows: string[][] = [];
  const suggestions: string[] = [];
  const skipped: string[] = [];

  for (const variant of STT_VARIANTS) {
    const targets = variant.id === 'baseline' ? clips : subset;
    const variantRuns: ClipRun[] = [];
    for (const clip of targets) {
      for (let repeat = 1; repeat <= ctx.args.repeats; repeat++) {
        ctx.log(`  B ${variant.id} ${clip.id} (#${repeat})`);
        try {
          const run = await runClipOnFreshConnection(ctx, 'B', variant, clip, repeat);
          if (run) variantRuns.push(run);
        } catch (error) {
          ctx.log(`    failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (variantRuns.length === 0) {
      skipped.push(variant.id);
      continue;
    }
    runs.push(...variantRuns);
    rows.push(rowFor(variant, variantRuns));

    if (variant.id !== 'baseline') {
      const delta = pairedDelta(
        runs.filter((r) => r.variant === 'baseline'),
        variantRuns,
      );
      deltaRows.push([
        variant.id,
        variant.change,
        String(delta.pairs),
        formatNumber(delta.werDelta, 2),
        formatNumber(delta.latencyDeltaMs, 0),
      ]);
      suggestions.push(`${variant.id}: ${verdict(delta)}`);
    }
  }

  return {
    id: 'B',
    title: 'B. STT streaming (fresh connection per clip)',
    tables: [
      {
        title: 'Per variant (latencies in ms, median (min-max); WER mean over clips)',
        headers: [
          'variant',
          'runs',
          'commit→processing',
          'commit→transcript',
          'reported `latency`',
          'press→transcript',
          'WER',
          'WER quiet / noisy',
          'keyterm hits',
          'VAD closed first',
          'no transcript',
          'pacer max late',
        ],
        rows,
      },
      {
        title: 'Paired change versus baseline on the same clips (negative = better)',
        headers: ['variant', 'what changed', 'pairs', 'WER Δ', 'commit→transcript Δ (ms)'],
        rows: deltaRows,
      },
    ],
    notes: [
      `Baseline used all ${clips.length} clips; other variants used ${subset.length} (${subset.map((c) => c.id).join(', ')}) to stay inside the audio budget.`,
      'WER compares normalized words against your reference text. Script differences (Devanagari vs Latin) and digits vs number words count as errors, so compare variants with each other, not against an absolute bar.',
      '"VAD closed first" counts runs where the transcript arrived before our commit (no commit→transcript is defined for them).',
      ...(skipped.length > 0 ? [`Skipped for budget: ${skipped.join(', ')}. Re-run with --max-audio-seconds raised to include them.`] : []),
      'A handful of clips per variant is noise-prone: treat differences smaller than the min-max spread as unproven.',
    ],
    data: runs,
    suggestions,
  };
}

export interface PairedDelta {
  pairs: number;
  werDelta: number | null;
  latencyDeltaMs: number | null;
}

/** Averages (variant - baseline) over clips that appear in both. */
export function pairedDelta(baseline: ClipRun[], variant: ClipRun[]): PairedDelta {
  const werDiffs: number[] = [];
  const latencyDiffs: number[] = [];
  let pairs = 0;
  for (const run of variant) {
    const base = baseline.find((b) => b.clipId === run.clipId && b.repeat === run.repeat);
    if (!base) continue;
    pairs += 1;
    if (run.wer !== null && base.wer !== null) werDiffs.push(run.wer - base.wer);
    const a = run.result.commitToTranscriptMs;
    const b = base.result.commitToTranscriptMs;
    if (a !== null && b !== null) latencyDiffs.push(a - b);
  }
  return { pairs, werDelta: mean(werDiffs), latencyDeltaMs: mean(latencyDiffs) };
}

/** Suggestion rule: accuracy first (2 points of WER), then at least 50 ms faster. Needs human review. */
export function verdict(delta: PairedDelta): string {
  if (delta.pairs < 2 || delta.werDelta === null) return `not enough paired clips (${delta.pairs}) to say anything`;
  const latency = delta.latencyDeltaMs ?? 0;
  const base = `ΔWER ${delta.werDelta.toFixed(2)}, Δlatency ${latency.toFixed(0)} ms over ${delta.pairs} pairs`;
  if (delta.werDelta <= -0.02) return `candidate to adopt: more accurate (${base})`;
  if (delta.werDelta >= 0.02) return `keep baseline: less accurate (${base})`;
  if (latency <= -50) return `candidate to adopt: same accuracy, faster (${base})`;
  return `no clear difference (${base})`;
}
