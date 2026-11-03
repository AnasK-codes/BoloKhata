import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TtsSession, audioMs, underruns, type TtsRequest, type TtsResult } from './ttsClient';
import { formatNumber, formatSummary, summarize } from './stats';
import type { ExperimentContext, ExperimentResult } from './types';
import { pcmToWav } from './wav';

/** Synthetic phrases only. Amounts are spoken Hindi number words, as the TTS docs ask. */
export interface Phrase {
  id: string;
  devanagari: string;
  latin: string;
}

export const PHRASES: Phrase[] = [
  {
    id: 'readback',
    devanagari: 'शर्मा जी के लिए दो किलो आटा और एक मैगी। कुल दो सौ पचास रुपये। ठीक है?',
    latin: 'Sharma ji ke liye do kilo aata aur ek Maggi. Kul do sau pachas rupaye. Theek hai?',
  },
  {
    id: 'balance',
    devanagari: 'शर्मा जी का उधार तीन सौ बीस रुपये है।',
    latin: 'Sharma ji ka udhaar teen sau bees rupaye hai.',
  },
  { id: 'done', devanagari: 'बिल बन गया।', latin: 'Bill ban gaya.' },
  { id: 'ack', devanagari: 'हाँ, लिख दिया।', latin: 'Haan, likh diya.' },
  {
    id: 'payment',
    devanagari: 'वर्मा जी ने दो सौ रुपये दिए। अब एक सौ पचास रुपये बाकी हैं।',
    latin: 'Verma ji ne do sau rupaye diye. Ab ek sau pachas rupaye baaki hain.',
  },
  {
    id: 'retry',
    devanagari: 'माफ़ कीजिए, समझ नहीं आया। दोबारा बोलिए।',
    latin: 'Maaf kijiye, samajh nahi aaya. Dobara boliye.',
  },
];

export interface TtsVariant {
  id: string;
  change: string;
  model: TtsRequest['model'];
  voice: string;
  language: string;
  script: 'devanagari' | 'latin';
  sampleRate: number;
  container: TtsRequest['container'];
}

const BASE: TtsVariant = {
  id: 'baseline',
  change: 'timbre-v2.5, Nalini, hi-IN, Devanagari, 24 kHz, raw',
  model: 'timbre-v2.5',
  voice: 'Nalini',
  language: 'hi-IN',
  script: 'devanagari',
  sampleRate: 24000,
  container: 'raw',
};

// Voice names come from the examples in the Gnani TTS docs; unlisted voices are not guessed.
export const TTS_VARIANTS: TtsVariant[] = [
  BASE,
  { ...BASE, id: 'v25_kaveri', change: 'voice Kaveri', voice: 'Kaveri' },
  { ...BASE, id: 'v30_shivani', change: 'timbre-v3.0, Shivani', model: 'timbre-v3.0', voice: 'Shivani' },
  { ...BASE, id: 'v30_avinash', change: 'timbre-v3.0, Avinash', model: 'timbre-v3.0', voice: 'Avinash' },
  { ...BASE, id: 'v25_hien_latin', change: 'language hi-en, Latin Hinglish text', language: 'hi-en', script: 'latin' },
  {
    ...BASE,
    id: 'v30_hien_latin',
    change: 'v3.0 Shivani, hi-en, Latin (hi-en is documented only for v2.5)',
    model: 'timbre-v3.0',
    voice: 'Shivani',
    language: 'hi-en',
    script: 'latin',
  },
  { ...BASE, id: 'sr_16000', change: 'sample rate 16 kHz', sampleRate: 16000 },
  { ...BASE, id: 'sr_48000', change: 'sample rate 48 kHz', sampleRate: 48000 },
  { ...BASE, id: 'container_wav', change: 'container wav', container: 'wav' },
];

/** Characters kept back so experiment E can still run after D has used its share. */
export const RESERVE_FOR_E = 120;

export const phraseText = (variant: TtsVariant, phrase: Phrase) =>
  variant.script === 'latin' ? phrase.latin : phrase.devanagari;

export const requestFor = (variant: TtsVariant, text: string): TtsRequest => ({
  text,
  model: variant.model,
  voice: variant.voice,
  language: variant.language,
  sampleRate: variant.sampleRate,
  container: variant.container,
});

interface PhraseRun {
  variant: string;
  phrase: string;
  chars: number;
  result: Omit<TtsResult, 'audio'>;
  audioMs: number;
  underruns: number;
  realTimeFactor: number | null;
}

function saveAudio(outDir: string, variant: TtsVariant, phrase: Phrase, result: TtsResult): string | null {
  if (result.audio.length === 0) return null;
  const dir = path.join(outDir, 'audio');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `tts-${variant.id}-${phrase.id}.wav`);
  // raw chunks are headerless PCM: wrap them. wav chunks already start with a header: keep as received.
  const bytes = variant.container === 'raw' ? pcmToWav(result.audio, variant.sampleRate) : result.audio;
  writeFileSync(file, bytes);
  return path.relative(path.dirname(outDir), file);
}

/** Experiment D: streaming TTS. Variants change one factor from the baseline. */
export async function runExperimentD(ctx: ExperimentContext): Promise<ExperimentResult> {
  const runs: PhraseRun[] = [];
  const rows: string[][] = [];
  const skipped: string[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  const saved: string[] = [];
  let rawFirstRiff = 0;
  let rawFirstTotal = 0;
  let laterRiff = 0;

  for (const variant of TTS_VARIANTS) {
    const phrases = variant.id === 'baseline' ? PHRASES : PHRASES.slice(0, ctx.args.ttsSubset);
    const variantRuns: PhraseRun[] = [];
    let session: TtsSession | null = null;
    try {
      for (const phrase of phrases) {
        const text = phraseText(variant, phrase);
        if (!ctx.budget.canSpendChars(text.length, RESERVE_FOR_E)) break;
        session ??= await TtsSession.open(ctx.env.ttsUrl, ctx.apiKey);
        ctx.log(`  D ${variant.id} ${phrase.id} (${text.length} chars)`);
        ctx.budget.spendChars('D', text.length);
        const result = await session.synthesize(requestFor(variant, text));
        const { audio, ...rest } = result;
        const duration = audioMs(audio.length, variant.sampleRate);
        variantRuns.push({
          variant: variant.id,
          phrase: phrase.id,
          chars: text.length,
          result: rest,
          audioMs: duration,
          underruns: underruns(result.chunks, variant.sampleRate),
          realTimeFactor: result.totalMs !== null && duration > 0 ? result.totalMs / duration : null,
        });
        if (result.error) failures.push(`${variant.id}/${phrase.id}: ${result.error}`);
        if (variant.container === 'raw' && result.firstChunkMagic !== null) {
          rawFirstTotal += 1;
          if (result.firstChunkMagic === 'RIFF') rawFirstRiff += 1;
          laterRiff += result.riffChunks;
        }
        const file = saveAudio(ctx.outDir, variant, phrase, result);
        if (file) saved.push(file);
      }
    } catch (error) {
      failures.push(`${variant.id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (session) {
        ctx.budget.spendConnection('D', session.connectionSeconds);
        await session.close();
      }
    }
    if (variantRuns.length === 0) {
      skipped.push(variant.id);
      continue;
    }
    runs.push(...variantRuns);
    rows.push(rowFor(variant, variantRuns));
  }

  const baseline = runs.filter((r) => r.variant === 'baseline');
  if (baseline.length > 0) {
    notes.push(
      `Raw container: ${rawFirstRiff} of ${rawFirstTotal} first chunks began with a "RIFF" header and ${laterRiff} later chunks did. Zero means raw chunks are headerless PCM that can be concatenated (we wrapped them in a WAV header ourselves for listening).`,
    );
  }
  notes.push(
    `${saved.length} audio files were written to the audio folder next to the results JSON. Listen to them: that is the only way to confirm the voice, the pronunciation of the amounts, and that chunk joins are gapless to a human ear.`,
    '"underruns" counts chunks that arrived after the audio already received would have finished playing, if playback began on the first chunk. 0 means gapless streaming was possible on this network.',
    'Real-time factor is request→complete divided by the audio length; below 1 means audio is produced faster than it plays.',
    ...(skipped.length > 0 ? [`Skipped for budget: ${skipped.join(', ')}. Re-run with --max-tts-chars raised to include them.`] : []),
    ...failures.map((f) => `Failure: ${f}`),
  );

  return {
    id: 'D',
    title: 'D. TTS streaming',
    tables: [
      {
        title: 'Per variant (ms, median (min-max))',
        headers: [
          'variant',
          'what changed',
          'phrases',
          'start',
          'first audio chunk',
          'total',
          'chunks',
          'median chunk bytes',
          'audio ms',
          'real-time factor',
          'underruns',
          'errors',
        ],
        rows,
      },
    ],
    notes,
    data: { runs, savedAudio: saved },
    suggestions: suggest(runs),
  };
}

function rowFor(variant: TtsVariant, variantRuns: PhraseRun[]): string[] {
  const num = (pick: (r: PhraseRun) => number | null) =>
    variantRuns.map(pick).filter((v): v is number => v !== null);
  return [
    variant.id,
    variant.change,
    String(variantRuns.length),
    formatSummary(summarize(num((r) => r.result.startMs))),
    formatSummary(summarize(num((r) => r.result.firstChunkMs))),
    formatSummary(summarize(num((r) => r.result.totalMs))),
    formatSummary(summarize(num((r) => r.result.chunks.length))),
    formatNumber(summarize(variantRuns.flatMap((r) => r.result.chunks.map((c) => c.bytes)))?.median),
    formatNumber(summarize(num((r) => r.audioMs))?.median),
    formatNumber(summarize(num((r) => r.realTimeFactor))?.median, 2),
    String(variantRuns.reduce((s, r) => s + r.underruns, 0)),
    String(variantRuns.filter((r) => r.result.error !== null).length),
  ];
}

function suggest(runs: PhraseRun[]): string[] {
  const ok = runs.filter((r) => r.result.error === null && r.result.firstChunkMs !== null);
  const byVariant = new Map<string, number[]>();
  for (const run of ok) {
    const list = byVariant.get(run.variant) ?? [];
    list.push(run.result.firstChunkMs ?? 0);
    byVariant.set(run.variant, list);
  }
  return [...byVariant.entries()]
    .map(([variant, values]) => ({ variant, median: summarize(values)?.median ?? Infinity, n: values.length }))
    .sort((a, b) => a.median - b.median)
    .map((v) => `${v.variant}: first-chunk median ${v.median.toFixed(0)} ms over ${v.n} phrases (faster is not automatically better: also listen to the audio)`);
}
