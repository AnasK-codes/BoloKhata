import { PHRASES, TTS_VARIANTS, phraseText, requestFor } from './expD';
import { TtsSession, ttsRequestBody } from './ttsClient';
import { formatNumber } from './stats';
import type { ExperimentContext, ExperimentResult } from './types';

const CONCURRENT_WINDOW_MS = 8000;

/** Experiment E: sequential reuse of one TTS socket, and ONE deliberate concurrent request. */
export async function runExperimentE(ctx: ExperimentContext): Promise<ExperimentResult> {
  const variant = TTS_VARIANTS[0];
  const [first, second] = [PHRASES[2], PHRASES[3]];
  if (!variant || !first || !second) throw new Error('experiment E fixtures missing');
  const texts = [phraseText(variant, first), phraseText(variant, second)] as const;
  const needed = texts[0].length * 2 + texts[1].length;

  if (!ctx.budget.canSpendChars(needed)) {
    return {
      id: 'E',
      title: 'E. TTS reuse and concurrency',
      tables: [],
      notes: [`Skipped: needs about ${needed} characters of TTS budget and the run has fewer left.`],
      data: { skipped: true },
      suggestions: [],
    };
  }

  const session = await TtsSession.open(ctx.env.ttsUrl, ctx.apiKey);
  const rows: string[][] = [];
  const data: Record<string, unknown> = {};
  try {
    for (const [i, text] of texts.entries()) {
      ctx.log(`  E sequential request ${i + 1}`);
      ctx.budget.spendChars('E', text.length);
      const { audio, ...result } = await session.synthesize(requestFor(variant, text));
      rows.push([
        `sequential #${i + 1}`,
        formatNumber(result.firstChunkMs),
        formatNumber(result.totalMs),
        String(result.chunks.length),
        result.error ?? (result.completed ? 'complete' : 'incomplete'),
      ]);
      data[`sequential${i + 1}`] = { ...result, audioBytes: audio.length };
    }

    // The one concurrent test: a second request while the first is still streaming.
    ctx.log('  E concurrent request (once)');
    const text = texts[0];
    ctx.budget.spendChars('E', text.length);
    session.sendRaw(ttsRequestBody(requestFor(variant, text)));
    await new Promise((resolve) => setTimeout(resolve, 30));
    session.sendRaw(ttsRequestBody(requestFor(variant, text)));
    const events = await session.drainFor(CONCURRENT_WINDOW_MS);
    data['concurrent'] = events;
    const count = (type: string) => events.filter((e) => e.type === type).length;
    const errorEvents = events.filter((e) => e.type === 'error');
    rows.push([
      'two requests 30 ms apart',
      '-',
      '-',
      `${count('audio')} audio`,
      `start×${count('start')}, complete×${count('complete')}, error×${errorEvents.length}`,
    ]);
  } finally {
    ctx.budget.spendConnection('E', session.connectionSeconds);
    await session.close();
  }

  return {
    id: 'E',
    title: 'E. TTS reuse and concurrency',
    tables: [
      {
        title: 'One socket, requests in sequence, then one concurrent attempt',
        headers: ['case', 'first chunk (ms)', 'total (ms)', 'chunks', 'outcome'],
        rows,
      },
    ],
    notes: [
      'The concurrent attempt was made once, on purpose, to learn what Gnani does. Our gateway still queues requests and never sends two at once.',
      'Read data.concurrent in the results JSON for the exact order of start/audio/complete/error messages.',
    ],
    data,
    suggestions: [],
  };
}
