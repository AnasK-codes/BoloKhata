import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startMockTts, type MockTtsServer } from '@bolbill/mock-gnani';
import { decodeTtsFrame, TTS_HEADER_BYTES } from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import { DailyCreditGuard } from '../guard/creditGuard';
import { testConfig } from '../testConfig';
import { sleep } from '../testing/client';
import { silentLogger } from '../util/logger';
import { phraseCacheKey, PhraseCache } from './phraseCache';
import { readFileSync, readdirSync } from 'node:fs';
import { prepareSpeechText as sanitizeSpeechText } from '@bolbill/shared';
import { buildTtsRequest, TtsLink, type TtsFailure } from './ttsLink';
import { fixedPhrases, planWarmup, runWarmup } from './warmPhrases';

let mock: MockTtsServer | undefined;
let link: TtsLink | undefined;
let tempDir: string | undefined;

afterEach(async () => {
  link?.close();
  link = undefined;
  await mock?.close();
  mock = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

const gnaniFor = (url: string): GatewayConfig['gnani'] => testConfig({ GNANI_TTS_URL: url }).gnani;

interface Recorder {
  link: TtsLink;
  /** Ordered log of what the browser would see. */
  log: string[];
  chunks: { turnId: number; pcmBytes: number }[];
  failures: TtsFailure[];
  budgets: number[];
  starts: { turnId: number; cached: boolean; sampleRate: number }[];
  ends: { turnId: number; interrupted: boolean }[];
}

function makeLink(
  url: string,
  options: Partial<ConstructorParameters<typeof TtsLink>[0]> = {},
): Recorder {
  const guard = new DailyCreditGuard({ stt_seconds: 0, tts_chars: 100_000 });
  link = new TtsLink({ gnani: gnaniFor(url), guard, log: silentLogger, ...options });
  const r: Recorder = { link, log: [], chunks: [], failures: [], budgets: [], starts: [], ends: [] };
  link.on('start', (turnId, info) => {
    r.log.push(`start:${turnId}`);
    r.starts.push({ turnId, ...info });
  });
  link.on('chunk', (turnId, frame) => {
    const decoded = decodeTtsFrame(frame);
    if (!decoded || decoded.turnId !== turnId) throw new Error('malformed TTS frame');
    r.log.push(`chunk:${turnId}`);
    r.chunks.push({ turnId, pcmBytes: decoded.pcm.byteLength });
  });
  link.on('end', (turnId, interrupted) => {
    r.log.push(`end:${turnId}${interrupted ? ':interrupted' : ''}`);
    r.ends.push({ turnId, interrupted });
  });
  link.on('failure', (f) => r.failures.push(f));
  link.on('budget', (turnId) => r.budgets.push(turnId));
  return r;
}

async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(10);
  }
}

const pcmBytesFor = (chars: number, sampleRate = 24_000) =>
  Math.round((sampleRate * 2 * Math.max(200, chars * 60)) / 1000 / 2) * 2;

describe('prepareSpeechText (sanitising, as the gateway uses it)', () => {
  it('strips control characters, tag-like markup and extra whitespace', () => {
    expect(sanitizeSpeechText('  Ho\u0000 gaya\n\n<break time="1s"/> [laughs]  save  ')).toBe('Ho gaya save');
  });
  it('rejects empty and markup-only text', () => {
    expect(sanitizeSpeechText('')).toBeNull();
    expect(sanitizeSpeechText('   \n\t ')).toBeNull();
    expect(sanitizeSpeechText('<a>[b]')).toBeNull();
  });
  it('limits the length', () => {
    expect(sanitizeSpeechText('a'.repeat(500))?.length).toBe(200);
  });
  it('keeps Devanagari and ordinary punctuation', () => {
    expect(sanitizeSpeechText('दो सौ रुपये, ठीक है?')).toBe('दो सौ रुपये, ठीक है?');
  });
});

describe('buildTtsRequest', () => {
  it('asks for raw 16-bit mono PCM at the configured rate', () => {
    const body = buildTtsRequest(gnaniFor('ws://x').tts, 'Namaste') as {
      audio_config: Record<string, unknown>;
      model: string;
    };
    expect(body.model).toBe('timbre-v2.5');
    expect(body.audio_config).toEqual({
      sample_rate: 24000,
      num_channels: 1,
      sample_width: 2,
      encoding: 'linear_pcm',
      container: 'raw',
    });
  });
});

describe('nothing reaches Timbre without the shared normaliser', () => {
  it('the text Gnani receives is exactly prepareSpeechText of what was asked', async () => {
    mock = await startMockTts({ chunkBytes: 4800 });
    const r = makeLink(mock.url);
    const asked = ['  Save kar dun? <laugh> ', 'Haan\u0007 bolo [pause].'];
    expect(r.link.speak(1, asked)).toBe(true);
    await until(() => r.ends.length === 1);
    expect(mock.requests.map((q) => q.text)).toEqual(asked.map((a) => sanitizeSpeechText(a)));
  });

  it('only ttsLink builds a synthesis request, and it runs every sentence through prepareSpeechText', () => {
    const dir = new URL('../', import.meta.url);
    const files = (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const builders = files.filter((f) => /buildTtsRequest\(|tts\.url/.test(readFileSync(new URL(f, dir), 'utf8')));
    expect(builders.map((f) => f.replace(/\\/g, '/'))).toEqual(['gnani/ttsLink.ts']);
    const source = readFileSync(new URL('gnani/ttsLink.ts', dir), 'utf8');
    expect(source).toMatch(/const text = prepareSpeechText\(sentence\)/);
  });
});

describe('TtsLink against the mock', () => {
  it('speaks sentences in order: start, chunks, end, one request per sentence', async () => {
    mock = await startMockTts({ chunkBytes: 4800 });
    const r = makeLink(mock.url);
    expect(r.link.speak(1, ['Pehla vaakya.', 'Doosra vaakya.'])).toBe(true);
    await until(() => r.ends.length === 1);

    expect(mock.requests.map((q) => q.text)).toEqual(['Pehla vaakya.', 'Doosra vaakya.']);
    expect(mock.requests.every((q) => q.container === 'raw' && q.sampleRate === 24000)).toBe(true);
    expect(r.log[0]).toBe('start:1');
    expect(r.log.at(-1)).toBe('end:1');
    expect(r.log.filter((e) => e.startsWith('start')).length).toBe(1); // one start per turn
    const total = r.chunks.reduce((sum, c) => sum + c.pcmBytes, 0);
    expect(total).toBe(pcmBytesFor('Pehla vaakya.'.length) + pcmBytesFor('Doosra vaakya.'.length));
    expect(r.starts[0]).toMatchObject({ turnId: 1, cached: false, sampleRate: 24000 });
  });

  it('forwards each chunk immediately rather than waiting for the whole reply', async () => {
    mock = await startMockTts({ chunkBytes: 4800, interChunkDelayMs: 40 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Yeh ek lamba sa jawab hai jo kai chunks mein aayega.']);
    await until(() => r.chunks.length >= 2);
    expect(r.ends).toHaveLength(0); // still streaming when the first chunks are already out
    await until(() => r.ends.length === 1, 5000);
  });

  it('never parallelises: two speaks queue behind each other on one connection', async () => {
    mock = await startMockTts({ interChunkDelayMs: 10 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Pehli baat.']);
    r.link.speak(2, ['Doosri baat.']);
    await until(() => r.ends.length === 2);
    expect(mock.rejectedConcurrent).toBe(0);
    expect(mock.requests.map((q) => q.text)).toEqual(['Pehli baat.', 'Doosri baat.']);
    const lastChunkOfOne = r.log.lastIndexOf('chunk:1');
    const firstChunkOfTwo = r.log.indexOf('chunk:2');
    expect(lastChunkOfOne).toBeLessThan(firstChunkOfTwo); // turn 1 fully before turn 2
    expect(r.log.indexOf('end:1')).toBeLessThan(r.log.indexOf('start:2'));
  });

  it('keeps every frame sample-aligned even if Gnani splits a sample across chunks', async () => {
    mock = await startMockTts({ chunkBytes: 4801 }); // odd size on purpose (mock rounds down to even)
    const r = makeLink(mock.url);
    r.link.speak(1, ['Namaste ji']);
    await until(() => r.ends.length === 1);
    expect(r.chunks.every((c) => c.pcmBytes % 2 === 0)).toBe(true);
  });

  it('interrupt stops forwarding at once, aborts the request and discards late chunks', async () => {
    mock = await startMockTts({ chunkBytes: 2400, interChunkDelayMs: 25 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Yeh bahut lamba jawab hai jisko beech mein rok diya jayega ji.']);
    await until(() => r.chunks.length >= 3);
    r.link.interrupt(1);
    const chunksAtInterrupt = r.chunks.length;
    expect(r.ends).toEqual([{ turnId: 1, interrupted: true }]);
    await sleep(400);
    expect(r.chunks.length).toBe(chunksAtInterrupt); // nothing arrives after the interrupt
    await until(() => mock!.requests[0]!.aborted === true);
    expect(mock.requests[0]!.completed).toBe(false);
  });

  it('after an interrupt the next reply works on the pre-warmed replacement socket', async () => {
    mock = await startMockTts({ chunkBytes: 2400, interChunkDelayMs: 25 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Pehla lamba jawab jo kat jayega, bahut lamba hai yeh wala.']);
    await until(() => r.chunks.length >= 2);
    r.link.interrupt(1);
    r.link.speak(2, ['Naya jawab.']);
    await until(() => r.ends.some((e) => e.turnId === 2 && !e.interrupted));
    expect(r.chunks.filter((c) => c.turnId === 1).length).toBeLessThan(10);
    expect(mock.requests.map((q) => q.text)).toContain('Naya jawab.');
  });

  it('interrupt drops queued sentences of that turn but keeps other turns', async () => {
    mock = await startMockTts({ interChunkDelayMs: 20 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Ek.', 'Do.', 'Teen.']);
    r.link.speak(2, ['Doosra turn.']);
    r.link.interrupt(1);
    await until(() => r.ends.some((e) => e.turnId === 2));
    expect(mock.requests.some((q) => q.text === 'Do.' || q.text === 'Teen.')).toBe(false);
    expect(r.chunks.some((c) => c.turnId === 2)).toBe(true);
  });

  it('interruptAll silences every turn (barge-in)', async () => {
    mock = await startMockTts({ chunkBytes: 2400, interChunkDelayMs: 25 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Bahut lamba jawab jo kabhi khatam nahi hota is demo mein.']);
    r.link.speak(2, ['Aur ek aur.']);
    await until(() => r.chunks.length >= 2);
    r.link.interruptAll();
    const n = r.chunks.length;
    await sleep(300);
    expect(r.chunks.length).toBe(n);
    expect(r.ends.map((e) => e.turnId)).toEqual([1]);
  });

  it('reconnects after Gnani drops the socket', async () => {
    mock = await startMockTts();
    const r = makeLink(mock.url);
    r.link.prewarm();
    await until(() => r.link.isConnected);
    mock.dropConnections(1011, 'boom');
    await until(() => !r.link.isConnected);
    r.link.speak(1, ['Wapas aa gaye.']);
    await until(() => r.ends.length === 1);
    expect(r.failures).toEqual([]);
  });

  it('reports a dropped socket mid-reply as TTS_UNAVAILABLE and recovers for the next reply', async () => {
    mock = await startMockTts({ chunkBytes: 2400, interChunkDelayMs: 40 });
    const r = makeLink(mock.url);
    r.link.speak(1, ['Yeh jawab beech mein toot jayega kyunki socket gir jayega.']);
    await until(() => r.chunks.length >= 1);
    mock.dropConnections(1011, 'boom');
    await until(() => r.failures.length === 1);
    expect(r.failures[0]).toMatchObject({ turnId: 1, code: 'TTS_UNAVAILABLE', retryable: true });
    expect(r.ends.at(-1)).toEqual({ turnId: 1, interrupted: false });
    r.link.speak(2, ['Theek ho gaya.']);
    await until(() => r.ends.some((e) => e.turnId === 2));
  });

  it('turns a Gnani error into a text-only fallback and keeps the connection usable', async () => {
    mock = await startMockTts();
    const r = makeLink(mock.url);
    mock.failNextRequest('Synthesis failed.');
    r.link.speak(1, ['Yeh fail hoga.', 'Yeh dobara nahi bola jayega.']);
    await until(() => r.failures.length === 1);
    expect(r.failures[0]).toMatchObject({ turnId: 1, code: 'TTS_UNAVAILABLE' });
    await sleep(100);
    expect(mock.requests).toHaveLength(0); // the second sentence of the failed turn was dropped
    r.link.speak(2, ['Ab chalega.']);
    await until(() => r.ends.some((e) => e.turnId === 2));
  });

  it('times out a request that never produces audio', async () => {
    mock = await startMockTts({ firstChunkDelayMs: 2000 });
    const r = makeLink(mock.url, { firstChunkTimeoutMs: 150 });
    r.link.speak(1, ['Bahut der ho gayi.']);
    await until(() => r.failures.length === 1);
    expect(r.failures[0]).toMatchObject({ code: 'TTS_UNAVAILABLE', retryable: true });
  });

  it('is unavailable (text-only) when Gnani cannot be reached, then fails fast during backoff', async () => {
    mock = await startMockTts();
    const url = mock.url;
    await mock.close();
    mock = undefined;
    const r = makeLink(url, { backoff: { baseMs: 300, maxMs: 300 } });
    r.link.speak(1, ['Awaaz nahi aayegi.']);
    await until(() => r.failures.length === 1, 4000);
    const startedAt = Date.now();
    r.link.speak(2, ['Phir koshish.']);
    await until(() => r.failures.length === 2);
    expect(Date.now() - startedAt).toBeLessThan(150); // no new handshake attempt inside the window
  });

  it('refuses text when the character budget is gone, without calling Gnani', async () => {
    mock = await startMockTts();
    const guard = new DailyCreditGuard({ stt_seconds: 0, tts_chars: 5 });
    const r = makeLink(mock.url, { guard });
    r.link.speak(1, ['Yeh vaakya paanch akshar se bada hai.']);
    await until(() => r.budgets.length === 1);
    expect(mock.requests).toHaveLength(0);
    expect(guard.usage().tts_chars).toBe(0);
  });

  it('counts the characters it synthesises against the credit guard', async () => {
    mock = await startMockTts();
    const guard = new DailyCreditGuard({ stt_seconds: 0, tts_chars: 1000 });
    const r = makeLink(mock.url, { guard });
    r.link.speak(1, ['Ek.', 'Do teen.']);
    await until(() => r.ends.length === 1);
    expect(guard.usage().tts_chars).toBe('Ek.'.length + 'Do teen.'.length);
  });

  it('rejects text with nothing speakable', async () => {
    mock = await startMockTts();
    const r = makeLink(mock.url);
    expect(r.link.speak(1, ['', '  ', '<x>'])).toBe(false);
    expect(r.link.speak(1, [])).toBe(false);
  });

  it('ignores calls after close', async () => {
    mock = await startMockTts();
    const r = makeLink(mock.url);
    r.link.close();
    expect(r.link.speak(1, ['Hello'])).toBe(false);
  });
});

describe('phrase cache', () => {
  it('serves a repeated phrase from the cache without calling Gnani again', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bolbill-cache-'));
    mock = await startMockTts({ chunkBytes: 4800 });
    const cache = new PhraseCache(tempDir, 1024 * 1024);
    const r = makeLink(mock.url, { cache });

    r.link.speak(1, ['Ho gaya, save kar diya.'], { cache: true });
    await until(() => r.ends.length === 1);
    await r.link.flush();
    r.link.speak(2, ['Ho gaya, save kar diya.'], { cache: true });
    await until(() => r.ends.length === 2);

    expect(mock.requests).toHaveLength(1);
    expect(r.starts.map((s) => s.cached)).toEqual([false, true]);
    const bytes = (turn: number) => r.chunks.filter((c) => c.turnId === turn).reduce((s, c) => s + c.pcmBytes, 0);
    expect(bytes(2)).toBe(bytes(1));
    expect(cache.hits).toBe(1);
    expect((await readdir(tempDir)).filter((f) => f.endsWith('.pcm'))).toHaveLength(1);
  });

  it('does not cache phrases that were not marked cacheable', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bolbill-cache-'));
    mock = await startMockTts();
    const r = makeLink(mock.url, { cache: new PhraseCache(tempDir, 1024 * 1024) });
    r.link.speak(1, ['Sharma ji ka bill hai.']);
    await until(() => r.ends.length === 1);
    r.link.speak(2, ['Sharma ji ka bill hai.']);
    await until(() => r.ends.length === 2);
    expect(mock.requests).toHaveLength(2);
    expect(await readdir(tempDir)).toEqual([]);
  });

  it('survives a restart: a new cache object finds the phrase on disk', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bolbill-cache-'));
    mock = await startMockTts();
    const first = makeLink(mock.url, { cache: new PhraseCache(tempDir, 1024 * 1024) });
    first.link.speak(1, ['Theek hai, likh liya.'], { cache: true });
    await until(() => first.ends.length === 1);
    await first.link.flush();
    first.link.close();

    const second = makeLink(mock.url, { cache: new PhraseCache(tempDir, 0) }); // memory layer off
    second.link.speak(1, ['Theek hai, likh liya.'], { cache: true });
    await until(() => second.ends.length === 1);
    expect(mock.requests).toHaveLength(1);
    expect(second.starts[0]!.cached).toBe(true);
  });

  it('streams a cached phrase in several framed chunks and honours an interrupt', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bolbill-cache-'));
    mock = await startMockTts();
    const cache = new PhraseCache(tempDir, 4 * 1024 * 1024);
    const text = 'Yeh ek lamba cached jawab hai jo kai chunks mein bhejna padega.';
    const key = phraseCacheKey({ text, voice: 'Nalini', model: 'timbre-v2.5', language: 'hi-IN', sampleRate: 24000 });
    await cache.set(key, new Uint8Array(48_000)); // 1 s of silence, 10 chunks of 4,800 bytes
    const r = makeLink(mock.url, { cache });
    // Interrupt from inside the listener: the very next chunk must not be forwarded.
    r.link.on('chunk', () => {
      if (r.chunks.length === 2) r.link.interrupt(1);
    });
    r.link.speak(1, [text], { cache: true });
    await until(() => r.ends.length === 1);
    await sleep(100);
    expect(r.chunks.length).toBe(2);
    expect(r.ends).toEqual([{ turnId: 1, interrupted: true }]);
    expect(mock.requests).toHaveLength(0);
  });

  it('treats a truncated file on disk as a miss', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bolbill-cache-'));
    const cache = new PhraseCache(tempDir, 1024);
    await writeFile(path.join(tempDir, 'abc.pcm'), Buffer.from([1, 2, 3]));
    expect(await cache.get('abc')).toBeNull();
    expect(cache.misses).toBe(1);
  });
});

describe('PhraseCache', () => {
  it('evicts the least recently used entry when the memory budget is exceeded', async () => {
    const cache = new PhraseCache(null, 100);
    await cache.set('a', new Uint8Array(40));
    await cache.set('b', new Uint8Array(40));
    await cache.get('a'); // a is now more recent than b
    await cache.set('c', new Uint8Array(40)); // 120 > 100: evict b
    expect(await cache.get('b')).toBeNull();
    expect(await cache.get('a')).not.toBeNull();
    expect(await cache.get('c')).not.toBeNull();
    expect(cache.bytesInMemory).toBeLessThanOrEqual(100);
  });

  it('ignores empty, odd-length and oversize entries', async () => {
    const cache = new PhraseCache(null, 1000);
    await cache.set('empty', new Uint8Array(0));
    await cache.set('odd', new Uint8Array(3));
    await cache.set('big', new Uint8Array(2000));
    expect(cache.bytesInMemory).toBe(0);
  });

  it('keys change with every parameter that changes the audio', () => {
    const base = { text: 'Hello', voice: 'Nalini', model: 'timbre-v2.5', language: 'hi-IN', sampleRate: 24000 };
    const keys = new Set([
      phraseCacheKey(base),
      phraseCacheKey({ ...base, text: 'Hello!' }),
      phraseCacheKey({ ...base, voice: 'Other' }),
      phraseCacheKey({ ...base, model: 'timbre-v3.0' }),
      phraseCacheKey({ ...base, language: 'hi-en' }),
      phraseCacheKey({ ...base, sampleRate: 16000 }),
    ]);
    expect(keys.size).toBe(6);
    expect(phraseCacheKey(base)).toBe(phraseCacheKey({ ...base }));
  });
});

describe('phrase warm-up', () => {
  it('lists only phrases with no names or amounts, each within the sentence limit', () => {
    const phrases = fixedPhrases();
    expect(phrases.length).toBeGreaterThan(10);
    expect(phrases).toContain('Ho gaya, save kar diya.');
    expect(phrases.every((p) => p.length <= 160 && !/\d/.test(p) && !/rupaye/.test(p))).toBe(true);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it('plans within the character budget and skips what is already cached', () => {
    const plan = planWarmup(['aaaa', 'bbbb', 'cccc', 'dd'], 8, new Set(['bbbb']));
    expect(plan.toSynthesize).toEqual(['aaaa', 'cccc']);
    expect(plan.alreadyCached).toEqual(['bbbb']);
    expect(plan.overBudget).toEqual(['dd']);
    expect(plan.chars).toBe(8);
  });

  it('fills the cache through the mock and never exceeds the budget', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'bolbill-cache-'));
    mock = await startMockTts();
    const cache = new PhraseCache(tempDir, 1024 * 1024);
    const plan = planWarmup(['Save ho gaya.', 'Cancel kar diya.', 'Theek hai?'], 30, new Set());
    const result = await runWarmup({ gnani: gnaniFor(mock.url), cache, plan, log: silentLogger });
    expect(result.failed).toBe(0);
    expect(result.synthesized).toBe(plan.toSynthesize.length);
    expect(mock.requests.map((q) => q.text)).toEqual(plan.toSynthesize);
    expect(result.chars).toBeLessThanOrEqual(30);
    expect((await readdir(tempDir)).filter((f) => f.endsWith('.pcm'))).toHaveLength(plan.toSynthesize.length);
  });
});

describe('header contract', () => {
  it('frames carry the 0x01 tag and the turn id ahead of the PCM', async () => {
    mock = await startMockTts();
    const frames: Uint8Array[] = [];
    const r = makeLink(mock.url);
    r.link.on('chunk', (_turnId, frame) => frames.push(frame));
    r.link.speak(0xabcdef01, ['Header jaanch.']);
    await until(() => r.ends.length === 1);
    const first = frames[0]!;
    expect(first[0]).toBe(0x01);
    expect(new DataView(first.buffer, first.byteOffset).getUint32(1, false)).toBe(0xabcdef01);
    expect(first.byteLength).toBeGreaterThan(TTS_HEADER_BYTES);
  });
});
