'use client';

import { useEffect, useState } from 'react';
import { DEV_CATALOG } from '@/lib/dev/devCatalog';
import { getGatewayUrl } from '@/lib/env';
import { useHoldOrLatch } from '@/lib/gesture/useHoldOrLatch';
import type { ConnectionState } from '@/lib/realtime/types';
import { createRealtimeSession, type RealtimeSession } from '@/lib/session/createSession';
import { turnMetrics } from '@/lib/turn/timing';
import { useTurnStore } from '@/lib/turn/useTurnStore';

const ms = (v: number | undefined) => (v === undefined ? '–' : `${Math.round(v)} ms`);

const CONNECTION_LABEL: Record<ConnectionState['status'], string> = {
  idle: 'Connecting…',
  connecting: 'Connecting…',
  ready: 'Online',
  reconnecting: 'Reconnecting…',
  limited: 'Demo busy',
  blocked: 'Blocked',
  closed: 'Offline',
};

export function VoiceApp() {
  const [session, setSession] = useState<RealtimeSession | null>(null);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'idle' });
  const [micLive, setMicLive] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    // Catalog is the synthetic shop until the local database exists.
    const created = createRealtimeSession({ gatewayUrl: getGatewayUrl(), getCatalog: () => DEV_CATALOG });
    setSession(created);
    const stopMic = created.mic.subscribe((s) => setMicLive(s.live));
    const poll = setInterval(() => setConnection(created.client.getState()), 250);
    return () => {
      clearInterval(poll);
      stopMic();
      created.dispose();
    };
  }, []);

  if (session === null) return null;
  return (
    <Body
      session={session}
      connection={connection}
      micLive={micLive}
      audioError={audioError}
      enable={() => session.enableAudio().then(() => setAudioError(null), () => setAudioError('Mic allow karo. Please allow the microphone and try again.'))}
    />
  );
}

function Body(props: { session: RealtimeSession; connection: ConnectionState; micLive: boolean; audioError: string | null; enable: () => void }) {
  const { session, connection, micLive, audioError, enable } = props;
  const c = session.controller;
  const phase = useTurnStore(c.store, (s) => s.phase);
  const mode = useTurnStore(c.store, (s) => s.mode);
  const transcript = useTurnStore(c.store, (s) => s.transcript);
  const draft = useTurnStore(c.store, (s) => s.draft);
  const pending = useTurnStore(c.store, (s) => s.pending);
  const error = useTurnStore(c.store, (s) => s.error);
  const degraded = useTurnStore(c.store, (s) => s.degraded);
  const turns = useTurnStore(c.store, (s) => s.turns);
  const [hud, setHud] = useState(false);

  const { buttonProps } = useHoldOrLatch({
    onStart: () => c.press(),
    onLatch: () => c.latch(),
    onStop: (reason) => (reason === 'abort' ? c.cancel() : c.release()),
  });

  const listening = phase === 'listening';
  const busy = phase === 'finishing' || phase === 'transcribing' || phase === 'drafting';
  const last = turns.at(-1);
  const m = last ? turnMetrics(last) : null;
  const label = !micLive
    ? 'Mic chalu karo'
    : listening
      ? mode === 'latched' ? 'Sun raha hoon… tap to stop' : 'Sun raha hoon… chhod do'
      : busy ? 'Samajh raha hoon…' : phase === 'speaking' ? 'Bol raha hoon… (tap to interrupt)' : 'Dabao aur bolo';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Bol-Bill</h1>
        <span className="rounded-full bg-stone-800 px-3 py-1 text-sm">
          {CONNECTION_LABEL[connection.status]}
        </span>
      </header>

      {connection.status === 'limited' && <p role="status" className="rounded-lg border border-amber-500 px-3 py-2 text-amber-300">{connection.message} Retrying automatically.</p>}
      {connection.status === 'blocked' && <p role="alert" className="rounded-lg border border-red-500 px-3 py-2 text-red-300">{connection.message}</p>}

      <section className="min-h-40 flex-1 rounded-xl bg-stone-900 p-4" aria-live="polite">
        {transcript && <p className="text-stone-300">&ldquo;{transcript}&rdquo;</p>}
        {draft?.bill && draft.bill.items.length > 0 && (
          <div className="mt-3">
            {draft.customer && <p className="font-semibold">{draft.customer.name}</p>}
            <ul className="mt-1 divide-y divide-stone-800">
              {draft.bill.items.map((i) => (
                <li key={i.productId} className="flex justify-between py-1">
                  <span>{i.name} · {i.quantity} {i.unit}</span>
                  <span>₹{i.lineTotal}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between font-bold"><span>Total</span><span>₹{draft.bill.total}</span></p>
            {draft.bill.udhaar > 0 && <p className="flex justify-between text-amber-300"><span>Udhaar</span><span>₹{draft.bill.udhaar}</span></p>}
          </div>
        )}
        {draft?.intent === 'query_balance' && draft.balance && <p className="mt-3 text-lg">Balance: ₹{draft.balance.balance}</p>}
        {draft && <p className="mt-3 text-stone-400">{draft.replyText.join(' ')}</p>}
        {degraded.length > 0 && <p className="mt-2 text-amber-300">Please check this bill before saving.</p>}
        {error && (
          <p role="alert" className="mt-3 text-red-300">
            {error.message}{' '}
            <button type="button" className="underline" onClick={() => c.dismissError()}>Theek hai</button>
          </p>
        )}
        {!transcript && !error && <p className="text-stone-500">Mic dabake bolo, jaise: &ldquo;Sharma ji ko do kilo aata, udhaar.&rdquo;</p>}
      </section>

      {pending && (
        <div className="flex gap-2">
          <button type="button" className="min-h-14 flex-1 rounded-xl bg-emerald-600 font-semibold text-white" onClick={() => c.confirm()}>Confirm (ya bolo &ldquo;haan&rdquo;)</button>
          <button type="button" className="min-h-14 rounded-xl bg-stone-700 px-5 font-semibold text-white" onClick={() => c.discard()}>Nahi</button>
        </div>
      )}
      {pending && <p className="text-xs text-stone-500">Preview only: the local ledger is not built yet, so confirming does not store anything.</p>}

      {!micLive ? (
        <div className="flex flex-col gap-1">
          <button type="button" className="min-h-14 rounded-xl bg-amber-500 px-4 font-semibold text-stone-950" onClick={enable}>{label}</button>
          {audioError && <p role="alert" className="text-red-300">{audioError}</p>}
        </div>
      ) : (
        <button
          type="button"
          {...buttonProps}
          aria-label="Microphone: hold to talk, or tap to latch"
          className={`min-h-28 rounded-full text-lg font-bold ${listening ? 'bg-red-500 text-white' : 'bg-amber-500 text-stone-950'}`}
        >
          {listening && <span className="mr-2" aria-hidden="true">●</span>}{label}
        </button>
      )}

      <footer className="text-xs text-stone-500">
        <button type="button" className="underline" onClick={() => setHud((v) => !v)}>{hud ? 'Hide' : 'Show'} latency</button>
        {hud && (
          <p className="mt-1">
            {m ? `release→processing ${ms(m.releaseToProcessing)} · →text ${ms(m.releaseToTranscript)} · →bill ${ms(m.releaseToDraft)} · →voice ${ms(m.releaseToFirstAudible)}` : 'No turn yet.'}
            {connection.status === 'ready' && connection.rttMs !== null ? ` · rtt ${Math.round(connection.rttMs)} ms` : ''}
          </p>
        )}
      </footer>
    </main>
  );
}
