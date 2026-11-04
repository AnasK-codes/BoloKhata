'use client';

import { useEffect, useRef, useState } from 'react';
import { getGatewayUrl } from '@/lib/env';
import { DEV_CATALOG } from '@/lib/dev/devCatalog';
import { devLog } from '@/lib/dev/devLog';
import { ToneMic } from '@/lib/dev/toneMic';
import { useHoldOrLatch } from '@/lib/gesture/useHoldOrLatch';
import type { ConnectionState } from '@/lib/realtime/types';
import { createRealtimeSession, type RealtimeSession } from '@/lib/session/createSession';
import { turnMetrics } from '@/lib/turn/timing';
import { useTurnStore } from '@/lib/turn/useTurnStore';
import type { PlaybackStats } from '@/lib/audio/playbackEngine';

const ms = (value: number | undefined) => (value === undefined ? '–' : `${Math.round(value)}`);

export function TurnLab() {
  const [useTone, setUseTone] = useState(false);
  const [session, setSession] = useState<RealtimeSession | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });
  const [log, setLog] = useState<string[]>([]);
  const [playback, setPlayback] = useState<PlaybackStats | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [micLive, setMicLive] = useState(false);
  const lastPhase = useRef('');

  const note = (line: string) => {
    devLog(line);
    setLog((lines) => [`${new Date().toLocaleTimeString()} ${line}`, ...lines].slice(0, 40));
  };

  // A new session whenever the microphone source changes.
  useEffect(() => {
    const created = createRealtimeSession({
      gatewayUrl: getGatewayUrl(),
      getCatalog: () => DEV_CATALOG,
      onPlaybackStats: setPlayback,
      ...(useTone ? { createMic: (onFrame: (frame: ArrayBuffer) => void) => new ToneMic(onFrame) } : {}),
    });
    setSession(created);
    setMicLive(false);
    const stopMic = created.mic.subscribe((state) => setMicLive(state.live));
    const stopStore = created.controller.store.subscribe((state) => {
      if (state.phase !== lastPhase.current) {
        lastPhase.current = state.phase;
        note(`phase ${state.phase}${state.turnId !== null ? ` (turn ${state.turnId})` : ''}`);
      }
    });
    const poll = setInterval(() => setConnection(created.client.getState()), 250);
    return () => {
      clearInterval(poll);
      stopMic();
      stopStore();
      created.dispose();
    };
    // `note` only appends to the log, so it is deliberately not a dependency.
  }, [useTone]);

  if (session === null) return null;
  return (
    <LabBody
      session={session}
      useTone={useTone}
      setUseTone={setUseTone}
      connection={connection}
      micLive={micLive}
      playback={playback}
      audioError={audioError}
      setAudioError={setAudioError}
      log={log}
    />
  );
}

interface LabBodyProps {
  session: RealtimeSession;
  useTone: boolean;
  setUseTone: (value: boolean) => void;
  connection: ConnectionState;
  micLive: boolean;
  playback: PlaybackStats | null;
  audioError: string | null;
  setAudioError: (message: string | null) => void;
  log: string[];
}

function LabBody({ session, useTone, setUseTone, connection, micLive, playback, audioError, setAudioError, log }: LabBodyProps) {
  const { controller } = session;
  const phase = useTurnStore(controller.store, (s) => s.phase);
  const mode = useTurnStore(controller.store, (s) => s.mode);
  const transcript = useTurnStore(controller.store, (s) => s.transcript);
  const draft = useTurnStore(controller.store, (s) => s.draft);
  const pending = useTurnStore(controller.store, (s) => s.pending);
  const error = useTurnStore(controller.store, (s) => s.error);
  const degraded = useTurnStore(controller.store, (s) => s.degraded);
  const turns = useTurnStore(controller.store, (s) => s.turns);

  const { buttonProps } = useHoldOrLatch({
    onStart: () => controller.press(),
    onLatch: () => controller.latch(),
    onStop: (reason) => (reason === 'abort' ? controller.cancel() : controller.release()),
  });

  const listening = phase === 'listening';
  const rtt = connection.status === 'ready' && connection.rttMs !== null ? ` · ${Math.round(connection.rttMs)} ms` : '';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6 text-sm">
      <h1 className="text-xl font-bold">Turn lab (dev only)</h1>

      <p className="rounded-lg bg-stone-800 px-3 py-2">
        Gateway <code>{getGatewayUrl()}</code>: <strong>{connection.status}</strong>
        {rtt}
        {connection.status === 'limited' ? ` (${connection.message})` : ''}
        {connection.status === 'blocked' ? ` (${connection.message})` : ''}
      </p>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={useTone} onChange={(e) => setUseTone(e.target.checked)} />
        Use a synthetic test tone instead of the microphone
      </label>
      {useTone && (
        <p className="rounded-lg border border-amber-500 px-3 py-2 text-amber-300">
          SYNTHETIC SOURCE: a 220 Hz test tone is being sent, not your voice. Transcripts will only be
          what the mock Gnani server is scripted to say.
        </p>
      )}

      {!micLive && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            className="min-h-12 rounded-lg bg-amber-500 px-4 font-semibold text-stone-950"
            onClick={() => session.enableAudio().then(() => setAudioError(null), (e: unknown) => setAudioError(String(e)))}
          >
            Enable audio and microphone
          </button>
          {audioError && <p className="text-red-400">{audioError}</p>}
        </div>
      )}

      <button
        type="button"
        disabled={!micLive}
        {...buttonProps}
        className={`min-h-28 rounded-2xl text-lg font-bold disabled:opacity-40 ${listening ? 'bg-red-500 text-white' : 'bg-emerald-600 text-white'}`}
      >
        {listening ? (mode === 'latched' ? 'Listening… tap to stop' : 'Listening… release to send') : 'Hold to talk · tap to latch'}
      </button>

      <section className="rounded-lg bg-stone-800 px-3 py-2">
        <p>
          Phase: <strong>{phase}</strong>
          {degraded.length > 0 ? ` · degraded: ${degraded.join(', ')}` : ''}
        </p>
        {error && (
          <p className="text-red-400">
            {error.code}: {error.message}{' '}
            <button type="button" className="underline" onClick={() => controller.dismissError()}>
              dismiss
            </button>
          </p>
        )}
        <p>Transcript: {transcript ?? '–'}</p>
        <p>
          Draft: {draft ? `${draft.intent} · ${draft.source} · total ${draft.bill?.total ?? '–'}` : '–'}
        </p>
        {draft && <p className="text-stone-400">{draft.replyText.join(' ')}</p>}
        {pending && (
          <div className="mt-2 flex gap-2">
            <button type="button" className="min-h-12 flex-1 rounded-lg bg-emerald-600 font-semibold text-white" onClick={() => controller.confirm()}>
              Confirm
            </button>
            <button type="button" className="min-h-12 flex-1 rounded-lg bg-stone-600 font-semibold text-white" onClick={() => controller.discard()}>
              Discard
            </button>
          </div>
        )}
      </section>

      <section className="rounded-lg bg-stone-800 px-3 py-2">
        <h2 className="font-semibold">Last turns (ms)</h2>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-stone-400">
              <th>turn</th>
              <th>1st frame</th>
              <th>rel→proc</th>
              <th>rel→text</th>
              <th>rel→draft</th>
              <th>rel→audio</th>
            </tr>
          </thead>
          <tbody>
            {[...turns].reverse().slice(0, 6).map((record) => {
              const m = turnMetrics(record);
              return (
                <tr key={record.turnId}>
                  <td>{record.turnId}</td>
                  <td>{ms(m.pressToFirstFrame)}</td>
                  <td>{ms(m.releaseToProcessing)}</td>
                  <td>{ms(m.releaseToTranscript)}</td>
                  <td>{ms(m.releaseToDraft)}</td>
                  <td>{ms(m.releaseToFirstAudible)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1 text-stone-400">
          Playback: {playback ? `buffered ${Math.round(playback.bufferedMs)} ms · underruns ${playback.underruns}` : '–'} · frames sent{' '}
          {session.client.stats.audioFramesSent} · dropped {session.client.stats.audioFramesDropped}
        </p>
      </section>

      <section className="rounded-lg bg-stone-900 px-3 py-2 font-mono text-xs text-stone-300">
        {log.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </section>
    </main>
  );
}
