import { selectedExperiments, parseSpikeArgs, type ExperimentId, type SpikeArgs } from './args';
import { Budget } from './budget';
import { ClipsMissingError, loadClips, pickSubset, type ClipSet } from './clips';
import { loadSpikeEnv, type SpikeEnv } from './env';
import { runExperimentA } from './expA';
import { runExperimentB, STT_VARIANTS } from './expB';
import { runExperimentC } from './expC';
import { PHRASES, RESERVE_FOR_E, TTS_VARIANTS, phraseText, runExperimentD } from './expD';
import { runExperimentE } from './expE';
import { pronunciationChars, runExperimentP } from './expP';
import { accounting, printTable, runMeta, runOutputDir, writeLatencyDoc, writeResultsJson } from './report';
import { STT_EXPERIMENTS, type ExperimentContext, type ExperimentResult } from './types';

const RUNNERS: Partial<Record<ExperimentId, (ctx: ExperimentContext) => Promise<ExperimentResult>>> = {
  A: runExperimentA,
  B: runExperimentB,
  C: runExperimentC,
  D: runExperimentD,
  E: runExperimentE,
  P: runExperimentP,
};

const MOCK_BANNER =
  'MOCK endpoints detected: these numbers describe a fake server and must never be quoted as Gnani results. docs/LATENCY.md will not be written.';

function estimateAudioSeconds(clipSet: ClipSet, args: SpikeArgs, experiments: ExperimentId[]): number {
  const all = clipSet.clips.reduce((s, c) => s + c.seconds, 0);
  const subset = pickSubset(clipSet.clips, args.subset).reduce((s, c) => s + c.seconds, 0);
  const three = pickSubset(clipSet.clips, 3).reduce((s, c) => s + c.seconds, 0);
  const shortest = Math.min(...clipSet.clips.map((c) => c.seconds));
  let total = 0;
  if (experiments.includes('B')) total += (all + subset * (STT_VARIANTS.length - 1)) * args.repeats;
  if (experiments.includes('C')) total += three * 2 + shortest * (args.skipLongIdle ? 2 : 3);
  return total;
}

function estimateTtsChars(args: SpikeArgs, experiments: ExperimentId[]): number {
  let total = 0;
  if (experiments.includes('D')) {
    for (const variant of TTS_VARIANTS) {
      const phrases = variant.id === 'baseline' ? PHRASES : PHRASES.slice(0, args.ttsSubset);
      total += phrases.reduce((s, p) => s + phraseText(variant, p).length, 0);
    }
  }
  if (experiments.includes('E')) total += RESERVE_FOR_E;
  if (experiments.includes('P')) total += pronunciationChars(args.entries);
  return total;
}

function printDryRun(args: SpikeArgs, env: SpikeEnv): void {
  const experiments = selectedExperiments(args);
  console.log('pnpm spike --dry-run: nothing is sent, no credits are spent.\n');
  console.log(`label:           ${args.label}`);
  console.log(`experiments:     ${experiments.join(', ')} (F, credit accounting, runs last)`);
  console.log(`STT endpoint:    ${env.sttUrl}`);
  console.log(`TTS endpoint:    ${env.ttsUrl}`);
  console.log(`API key:         ${env.apiKey ? 'present (not shown)' : 'MISSING: set GNANI_API_KEY in .env before a real run'}`);
  console.log(`mock endpoints:  ${env.mock ? 'yes' : 'no'}`);
  console.log(`budget:          ${args.maxAudioSeconds} s of audio, ${args.maxTtsChars} TTS characters\n`);

  const describe: Record<ExperimentId, string> = {
    A: 'connection costs: DNS, TCP+TLS, WebSocket upgrade, 5 repeats each for STT and TTS',
    B: `STT: ${STT_VARIANTS.length} variants (${STT_VARIANTS.map((v) => v.id).join(', ')}); baseline on all clips, others on ${args.subset} clips; repeats ${args.repeats}`,
    C: `STT reuse: 3 utterances on one socket vs fresh sockets; idle gaps of ${args.skipLongIdle ? '60 s' : '60 s and 300 s'} (wall-clock waiting)`,
    D: `TTS: ${TTS_VARIANTS.length} variants (${TTS_VARIANTS.map((v) => v.id).join(', ')}); baseline on ${PHRASES.length} phrases, others on ${args.ttsSubset}`,
    E: 'TTS reuse: two sequential requests, then ONE deliberate concurrent request',
    F: 'credit accounting: audio seconds and characters actually sent',
    P: 'pronunciation A/B: every candidate spelling in the corpus, one request at a time, plus a listening sheet (opt-in)',
  };
  for (const id of experiments) console.log(`  ${id}. ${describe[id]}`);

  const needsClips = experiments.some((id) => STT_EXPERIMENTS.includes(id));
  if (needsClips) {
    try {
      const clipSet = loadClips(args.clipsDir);
      const seconds = estimateAudioSeconds(clipSet, args, experiments);
      console.log(`\nclips: ${clipSet.clips.length} found in ${clipSet.dir}, ${clipSet.clips.reduce((s, c) => s + c.seconds, 0).toFixed(1)} s in total`);
      console.log(`estimated STT audio if nothing is skipped: ${seconds.toFixed(0)} s (budget ${args.maxAudioSeconds} s; variants that do not fit are skipped, last ones first)`);
    } catch (error) {
      if (!(error instanceof ClipsMissingError)) throw error;
      console.log(`\nclips: NOT READY. ${error.message}`);
    }
  }
  const chars = estimateTtsChars(args, experiments);
  if (chars > 0) {
    console.log(`estimated TTS characters if nothing is skipped: ${chars} (budget ${args.maxTtsChars})`);
  }
  console.log('\nRun without --dry-run to spend credits.');
}

export async function main(argv: string[]): Promise<number> {
  let args: SpikeArgs;
  try {
    args = parseSpikeArgs(argv);
  } catch (error) {
    console.error(`spike: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const env = loadSpikeEnv();
  if (args.dryRun) {
    printDryRun(args, env);
    return 0;
  }

  const experiments = selectedExperiments(args).filter((id) => id !== 'F');
  let clips: ClipSet | null = null;
  if (experiments.some((id) => STT_EXPERIMENTS.includes(id))) {
    try {
      clips = loadClips(args.clipsDir);
    } catch (error) {
      if (!(error instanceof ClipsMissingError)) throw error;
      console.error(`spike: refusing to run. ${error.message}`);
      return 1;
    }
  }
  if (!env.apiKey && !env.mock) {
    console.error('spike: refusing to run. GNANI_API_KEY is not set (copy .env.example to .env and fill it in).');
    return 1;
  }
  if (env.mock) console.warn(`\n${MOCK_BANNER}\n`);

  const budget = new Budget({ maxAudioSeconds: args.maxAudioSeconds, maxTtsChars: args.maxTtsChars });
  const startedAt = new Date();
  const outDir = runOutputDir(args.label, startedAt);
  const ctx: ExperimentContext = {
    args,
    env,
    apiKey: env.apiKey ?? 'mock-key',
    budget,
    clips,
    outDir,
    log: (line) => console.log(line),
  };

  console.log(`This run spends credits: up to ${args.maxAudioSeconds} s of STT audio and ${args.maxTtsChars} TTS characters.`);
  const results: ExperimentResult[] = [];
  for (const id of experiments) {
    const runner = RUNNERS[id];
    if (!runner) continue;
    console.log(`\n=== Experiment ${id} ===`);
    try {
      const result = await runner(ctx);
      results.push(result);
      result.tables.forEach(printTable);
      result.notes.forEach((n) => console.log(`note: ${n}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Experiment ${id} failed: ${message}`);
      results.push({ id, title: `${id}. FAILED`, tables: [], notes: [`Failed: ${message}`], data: null, suggestions: [] });
    }
  }

  const finalAccounting = accounting(budget);
  console.log('\n=== F. Credit accounting ===');
  printTable(finalAccounting.tables[0] ?? { title: '', headers: [], rows: [] });
  finalAccounting.notes.forEach((n) => console.log(`note: ${n}`));

  const meta = runMeta(args, env, startedAt);
  const resultsFile = writeResultsJson(outDir, meta, [...results, finalAccounting], budget);
  console.log(`\nRaw results: ${resultsFile}`);

  const complete = args.only === null;
  if (env.mock) {
    console.log('docs/LATENCY.md not written: mock run.');
  } else if (!complete) {
    console.log('docs/LATENCY.md not updated: this was a partial run (--only). Run all experiments to regenerate it.');
  } else {
    console.log(`Wrote ${writeLatencyDoc(meta, results, budget, resultsFile)}`);
  }
  return results.some((r) => r.title.endsWith('FAILED')) ? 1 : 0;
}
