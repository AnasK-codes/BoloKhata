import { describe, expect, it } from 'vitest';
import { parseSpikeArgs, selectedExperiments } from './args';
import { Budget } from './budget';
import { pickSubset, type Clip } from './clips';
import { frameOffsetsMs } from './pacer';
import { pairedDelta, verdict, type ClipRun } from './expB';
import { keytermHits, normalizeText, summarize, wordErrorRate } from './stats';
import { underruns } from './ttsClient';
import { pcmToWav, readClipPcm } from './wav';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('args', () => {
  it('has safe defaults', () => {
    const args = parseSpikeArgs([]);
    expect(args).toMatchObject({ dryRun: false, only: null, maxAudioSeconds: 150, maxTtsChars: 1500, label: 'local' });
  });

  it('parses --only in any case, comma separated or repeated', () => {
    expect(parseSpikeArgs(['--only', 'a,d', '--only', 'E']).only).toEqual(['A', 'D', 'E']);
    expect(selectedExperiments(parseSpikeArgs([]))).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('rejects unknown experiments, bad labels and non-positive budgets', () => {
    expect(() => parseSpikeArgs(['--only', 'Z'])).toThrow(/unknown experiment/);
    expect(() => parseSpikeArgs(['--label', '../x'])).toThrow(/label/);
    expect(() => parseSpikeArgs(['--max-audio-seconds', '0'])).toThrow(/positive/);
  });
});

describe('budget', () => {
  it('blocks spending past the limit and honours the reserve', () => {
    const budget = new Budget({ maxAudioSeconds: 10, maxTtsChars: 100 });
    expect(budget.canSpendAudio(10)).toBe(true);
    budget.spendAudio('B', 8);
    expect(budget.canSpendAudio(3)).toBe(false);
    budget.spendChars('D', 60);
    expect(budget.canSpendChars(40)).toBe(true);
    expect(budget.canSpendChars(40, 10)).toBe(false);
    expect(budget.breakdown()).toEqual([
      { experiment: 'B', audioSeconds: 8, ttsChars: 0, connectionSeconds: 0 },
      { experiment: 'D', audioSeconds: 0, ttsChars: 60, connectionSeconds: 0 },
    ]);
  });
});

describe('pacer schedule', () => {
  it('is strictly real time by default', () => {
    expect(frameOffsetsMs(4, { preRollMs: 0, drainMs: 0 })).toEqual([0, 32, 64, 96]);
  });

  it('bursts the pre-roll at the start', () => {
    expect(frameOffsetsMs(6, { preRollMs: 64, drainMs: 0 })).toEqual([0, 0, 0, 32, 64, 96]);
  });

  it('sends the drained tail right behind the last paced frame', () => {
    expect(frameOffsetsMs(6, { preRollMs: 0, drainMs: 64 })).toEqual([0, 32, 64, 96, 96, 96]);
  });

  it('copes with a drain longer than the clip', () => {
    expect(frameOffsetsMs(2, { preRollMs: 0, drainMs: 1000 })).toEqual([0, 0]);
  });
});

describe('text scoring', () => {
  it('normalizes case and punctuation but keeps Devanagari', () => {
    expect(normalizeText('Haan, THEEK hai!')).toBe('haan theek hai');
    expect(normalizeText('दो किलो, आटा।')).toBe('दो किलो आटा');
  });

  it('computes word error rate', () => {
    expect(wordErrorRate('do kilo aata', 'do kilo aata')).toBe(0);
    expect(wordErrorRate('do kilo aata', 'do kilo')).toBeCloseTo(1 / 3);
    expect(wordErrorRate('do kilo aata', 'teen kilo aata aur')).toBeCloseTo(2 / 3);
    expect(wordErrorRate('', 'anything')).toBeNull();
  });

  it('counts key terms only when they were actually said', () => {
    expect(keytermHits(['Sharma', 'Maggi', 'udhaar'], 'Sharma ji ko Maggi', 'sharma ji ko maggi')).toEqual({
      expected: 2,
      hit: 2,
    });
    expect(keytermHits(['Sharma', 'Maggi'], 'Sharma ji ko Maggi', 'sharma ji ko magi')).toEqual({ expected: 2, hit: 1 });
  });

  it('summarizes and ignores non-finite values', () => {
    expect(summarize([])).toBeNull();
    expect(summarize([3, 1, 2, NaN])).toMatchObject({ n: 3, min: 1, median: 2, max: 3, mean: 2 });
  });
});

describe('wav', () => {
  it('round-trips PCM and pads to whole frames', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'spike-wav-'));
    const file = path.join(dir, 'a.wav');
    writeFileSync(file, pcmToWav(new Uint8Array(1500), 16000));
    expect(readClipPcm(file).length).toBe(2048);
  });

  it('rejects the wrong sample rate', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'spike-wav-'));
    const file = path.join(dir, 'b.wav');
    writeFileSync(file, pcmToWav(new Uint8Array(2048), 44100));
    expect(() => readClipPcm(file)).toThrow(/16 kHz mono/);
  });
});

describe('clip subset', () => {
  const clip = (id: string, noisy: boolean): Clip => ({ id, text: id, noisy, pcm: Buffer.alloc(0), seconds: 1 });
  it('mixes quiet and noisy clips, keeping file order', () => {
    const clips = [clip('a', false), clip('b', false), clip('c', true), clip('d', true)];
    expect(pickSubset(clips, 2).map((c) => c.id)).toEqual(['a', 'c']);
    expect(pickSubset(clips, 10)).toHaveLength(4);
  });
});

describe('tts playability', () => {
  it('counts a chunk that arrives after queued audio would have run out', () => {
    // 24 kHz: 4,800 bytes = 100 ms of audio per chunk.
    const chunks = [
      { index: 0, bytes: 4800, atMs: 0 },
      { index: 1, bytes: 4800, atMs: 50 },
      { index: 2, bytes: 4800, atMs: 400 },
    ];
    expect(underruns(chunks, 24000)).toBe(1);
  });
});

describe('variant verdicts', () => {
  const run = (variant: string, clipId: string, wer: number, latency: number): ClipRun => ({
    variant,
    clipId,
    noisy: false,
    repeat: 1,
    connectedMs: 100,
    wer,
    keytermExpected: 0,
    keytermHit: 0,
    result: {
      framesSent: 10,
      audioSeconds: 1,
      maxLateMs: 1,
      streamMs: 320,
      commitToProcessingMs: 50,
      commitToTranscriptMs: latency,
      reportedLatencyMs: latency,
      vadClosedFirst: false,
      transcripts: [],
      text: '',
      errors: [],
    },
  });

  it('pairs runs by clip and averages the differences', () => {
    const base = [run('baseline', 'a', 0.3, 400), run('baseline', 'b', 0.2, 500)];
    const variant = [run('x', 'a', 0.1, 300), run('x', 'b', 0.1, 400)];
    const delta = pairedDelta(base, variant);
    expect(delta.pairs).toBe(2);
    expect(delta.werDelta).toBeCloseTo(-0.15);
    expect(delta.latencyDeltaMs).toBeCloseTo(-100);
    expect(verdict(delta)).toMatch(/more accurate/);
  });

  it('refuses to judge from fewer than two pairs', () => {
    expect(verdict({ pairs: 1, werDelta: -0.5, latencyDeltaMs: -500 })).toMatch(/not enough/);
  });

  it('prefers speed only when accuracy is a tie', () => {
    expect(verdict({ pairs: 3, werDelta: 0, latencyDeltaMs: -80 })).toMatch(/faster/);
    expect(verdict({ pairs: 3, werDelta: 0.1, latencyDeltaMs: -300 })).toMatch(/keep baseline/);
  });
});
