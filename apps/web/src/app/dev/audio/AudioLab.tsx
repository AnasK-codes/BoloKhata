'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_FRAME_BYTES } from '@bolbill/shared';
import { unlockAudio } from '@/lib/audio/audioContext';
import {
  DEFAULT_MIC_SETTINGS,
  MicCapture,
  type MicSettings,
  type MicState,
} from '@/lib/audio/micCapture';
import {
  PlaybackEngine,
  type FirstAudible,
  type PlaybackStats,
} from '@/lib/audio/playbackEngine';

type Delivery = 'burst' | 'steady' | 'jittery';

const TTS_RATE = 24000;
const CHUNK_MS = 40;

function toneChunk(startSample: number, ms: number): Uint8Array {
  const samples = Math.round((TTS_RATE * ms) / 1000);
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i++) {
    pcm[i] = Math.round(6000 * Math.sin((2 * Math.PI * 440 * (startSample + i)) / TTS_RATE));
  }
  return new Uint8Array(pcm.buffer);
}

export function AudioLab() {
  const mic = useRef<MicCapture | null>(null);
  const playback = useRef<PlaybackEngine | null>(null);
  const meter = useRef<HTMLDivElement>(null);
  const frameStats = useRef({ frames: 0, bytes: 0, bad: 0 });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const turn = useRef(0);
  const pressedAt = useRef(0);

  const [ready, setReady] = useState(false);
  const [micState, setMicState] = useState<MicState>({ status: 'off', live: false });
  const [settings, setSettings] = useState<MicSettings>(DEFAULT_MIC_SETTINGS);
  const [gate, setGate] = useState(false);
  const [frames, setFrames] = useState({ frames: 0, bytes: 0, bad: 0 });
  const [stats, setStats] = useState<PlaybackStats | null>(null);
  const [audible, setAudible] = useState<FirstAudible | null>(null);
  const [playedAt, setPlayedAt] = useState(0);
  const [delivery, setDelivery] = useState<Delivery>('jittery');
  const [prefill, setPrefill] = useState(80);
  const [rate, setRate] = useState(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const start = useCallback(async () => {
    const context = await unlockAudio();
    setRate(context.sampleRate);
    const engine = new PlaybackEngine(context, {
      onStats: setStats,
      onFirstAudible: (event) => {
        setAudible(event);
      },
    });
    await engine.init();
    playback.current = engine;
    const capture = new MicCapture(context, {
      settings,
      onFrame: (frame) => {
        const s = frameStats.current;
        s.frames++;
        s.bytes += frame.byteLength;
        if (frame.byteLength !== AUDIO_FRAME_BYTES) s.bad++;
      },
      onLevel: (rms) => {
        if (meter.current) meter.current.style.width = `${Math.min(100, Math.sqrt(rms) * 140)}%`;
      },
    });
    capture.subscribe(setMicState);
    mic.current = capture;
    await capture.start();
    setReady(true);
  }, [settings]);

  useEffect(() => {
    const id = setInterval(() => setFrames({ ...frameStats.current }), 250);
    return () => {
      clearInterval(id);
      clearTimers();
      mic.current?.dispose();
      playback.current?.dispose();
    };
  }, []);

  const playTone = (seconds: number) => {
    const engine = playback.current;
    if (!engine) return;
    clearTimers();
    engine.setPrefillMs(prefill);
    const id = ++turn.current;
    setAudible(null);
    setPlayedAt(performance.now());
    engine.beginTurn(id, TTS_RATE);
    const count = Math.round((seconds * 1000) / CHUNK_MS);
    let at = 0;
    for (let i = 0; i < count; i++) {
      const chunk = toneChunk(i * ((TTS_RATE * CHUNK_MS) / 1000), CHUNK_MS);
      if (delivery === 'burst') at = 0;
      else if (delivery === 'steady') at = i * CHUNK_MS;
      else at += Math.random() * CHUNK_MS * 2; // mean one chunk per CHUNK_MS, but uneven
      timers.current.push(setTimeout(() => engine.pushPcm(id, chunk), at));
    }
    timers.current.push(setTimeout(() => engine.endTurn(id), at + 1));
  };

  const interrupt = () => {
    clearTimers();
    playback.current?.flush();
  };

  const toggleSetting = (key: keyof MicSettings) => {
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    void mic.current?.updateSettings(next);
  };

  const press = () => {
    pressedAt.current = performance.now();
    frameStats.current = { frames: 0, bytes: 0, bad: 0 };
    mic.current?.openGate();
    setGate(true);
  };
  const release = () => {
    void mic.current?.closeGate();
    setGate(false);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 py-6 text-sm">
      <h1 className="text-xl font-bold">Audio lab (dev only)</h1>

      {!ready ? (
        <button
          type="button"
          onClick={() => void start()}
          className="min-h-12 rounded-lg bg-amber-500 px-4 font-semibold text-stone-950"
        >
          Start audio and microphone
        </button>
      ) : (
        <p className="text-stone-400">
          Context {rate} Hz · mic {micState.status}
          {micState.error ? ` (${micState.error})` : ''} · mic live: {String(micState.live)}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Microphone</h2>
        <div className="h-4 w-full overflow-hidden rounded bg-stone-800">
          <div ref={meter} className="h-full w-0 bg-emerald-500" />
        </div>
        <div className="flex flex-wrap gap-3 text-stone-300">
          {(Object.keys(settings) as (keyof MicSettings)[]).map((key) => (
            <label key={key} className="flex items-center gap-1">
              <input type="checkbox" checked={settings[key]} onChange={() => toggleSetting(key)} />
              {key}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={!ready}
          onPointerDown={press}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={() => gate && release()}
          className={`min-h-14 rounded-lg px-4 font-semibold select-none touch-none ${gate ? 'bg-red-500 text-white' : 'bg-stone-700 text-stone-100'} disabled:opacity-40`}
        >
          {gate ? 'Gate OPEN: sending frames' : 'Hold to open the gate'}
        </button>
        <p className="text-stone-400">
          Frames {frames.frames} · bytes {frames.bytes} · wrong size {frames.bad}
          {frames.frames > 0 && frames.bytes === frames.frames * AUDIO_FRAME_BYTES ? ' ✓ all 1,024 B' : ''}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Playback</h2>
        <div className="flex gap-3">
          {(['jittery', 'steady', 'burst'] as const).map((d) => (
            <label key={d} className="flex items-center gap-1">
              <input type="radio" name="delivery" checked={delivery === d} onChange={() => setDelivery(d)} />
              {d}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2">
          Prefill {prefill} ms
          <input type="range" min={0} max={300} step={10} value={prefill} onChange={(e) => setPrefill(Number(e.target.value))} />
        </label>
        <div className="flex gap-2">
          <button type="button" disabled={!ready} onClick={() => playTone(4)} className="min-h-12 flex-1 rounded-lg bg-sky-600 px-3 font-semibold text-white disabled:opacity-40">
            Play 4 s tone
          </button>
          <button type="button" disabled={!ready} onClick={interrupt} className="min-h-12 flex-1 rounded-lg bg-red-600 px-3 font-semibold text-white disabled:opacity-40">
            Interrupt
          </button>
        </div>
        <p className="text-stone-400">
          {stats
            ? `buffered ${stats.bufferedMs.toFixed(0)} ms · waiting ${stats.pendingMs.toFixed(0)} ms · underruns ${stats.underruns} · overflow ${stats.overflowed} · ${stats.playing ? 'playing' : 'idle'}`
            : 'no stats yet'}
        </p>
        <p className="text-stone-400">
          {audible
            ? `first audible ${(audible.perfMs - playedAt).toFixed(0)} ms after the button (${audible.method})`
            : 'first audible: waiting'}
        </p>
      </section>
    </main>
  );
}
