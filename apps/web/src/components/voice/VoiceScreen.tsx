'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DraftMessage } from '@bolbill/shared';
import { useLive } from '@/lib/db/live';
import { useHoldOrLatch } from '@/lib/gesture/useHoldOrLatch';
import type { MicState } from '@/lib/audio/micCapture';
import type { ConnectionState } from '@/lib/realtime/types';
import { useSettings } from '@/lib/settings';
import { useOnline } from '@/lib/useOnline';
import { useTurnStore } from '@/lib/turn/useTurnStore';
import { draftFromTranscript } from '@/lib/voice/draftEdit';
import { connectionNotice, friendlyError, micErrorText } from '@/lib/voice/errorText';
import { statusText } from '@/lib/voice/statusText';
import { useApp } from '../AppProvider';
import { BillCard } from './BillCard';
import { BalanceCard, PaymentCard } from './InfoCards';
import { LatencyHud } from './LatencyHud';
import { MicButton } from './MicButton';
import { ReplaceDialog } from './ReplaceDialog';

const EXAMPLES = ['Sharma ji ko do kilo aata aur ek Maggi, udhaar likh do', 'Sharma ji ka kitna udhaar hai?', 'Verma ji ne do sau de diye'];

function Notice({ title, hint, tone = 'warn', action }: { title: string; hint: string; tone?: 'warn' | 'error'; action?: { label: string; run(): void } }) {
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 ${tone === 'error' ? 'border-red-500/70 bg-red-500/10' : 'border-amber-500/60 bg-amber-500/10'}`}>
      <p className="font-bold">{title}</p>
      <p className="text-stone-200">{hint}</p>
      {action && <button type="button" onClick={action.run} className="mt-2 min-h-12 rounded-xl bg-stone-700 px-4 font-semibold">{action.label}</button>}
    </div>
  );
}

export function VoiceScreen() {
  const { session, repo, dataError } = useApp();
  if (dataError) return <main className="mx-auto max-w-md px-4 py-10"><Notice tone="error" title="Data nahi khul paya" hint={dataError} /></main>;
  if (!session || !repo) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4" aria-busy="true">
        <p className="text-stone-400">Shuru ho raha hai…</p>
      </main>
    );
  }
  return <Voice session={session} repo={repo} />;
}

function Voice({ session, repo }: { session: NonNullable<ReturnType<typeof useApp>['session']>; repo: NonNullable<ReturnType<typeof useApp>['repo']> }) {
  const { toast } = useApp();
  const controller = session.controller;
  const store = controller.store;
  const phase = useTurnStore(store, (s) => s.phase);
  const mode = useTurnStore(store, (s) => s.mode);
  const heard = useTurnStore(store, (s) => s.heard);
  const transcript = useTurnStore(store, (s) => s.transcript);
  const draft = useTurnStore(store, (s) => s.draft);
  const pending = useTurnStore(store, (s) => s.pending);
  const replacement = useTurnStore(store, (s) => s.replacement);
  const error = useTurnStore(store, (s) => s.error);
  const degraded = useTurnStore(store, (s) => s.degraded);
  const turns = useTurnStore(store, (s) => s.turns);
  const hud = useSettings((s) => s.hud);

  const online = useOnline();
  const [connection, setConnection] = useState<ConnectionState>(session.client.getState());
  const [mic, setMic] = useState<MicState>(session.mic.getState());
  const [audioStarting, setAudioStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  useEffect(() => {
    const id = setInterval(() => setConnection(session.client.getState()), 300);
    const stop = session.mic.subscribe(setMic);
    setMic(session.mic.getState());
    return () => {
      clearInterval(id);
      stop();
    };
  }, [session]);

  const products = useLive(() => repo.listProducts(), [repo]);
  const customers = useLive(() => repo.listCustomersWithBalance(), [repo]);

  const buzz = (ms: number) => {
    try {
      navigator.vibrate?.(ms);
    } catch {
      // haptics are a nicety
    }
  };

  const { buttonProps } = useHoldOrLatch({
    onStart: () => {
      buzz(18);
      controller.press();
    },
    onLatch: () => controller.latch(),
    onStop: (reason) => {
      buzz(10);
      if (reason === 'abort') controller.cancel();
      else controller.release();
    },
  });

  const enable = useCallback(async () => {
    setAudioStarting(true);
    try {
      await session.enableAudio();
    } catch {
      toast('Mic start nahi hua. Permission check karo.', 'error');
    } finally {
      setAudioStarting(false);
    }
  }, [session, toast]);

  const listening = phase === 'listening';
  const busy = phase === 'finishing' || phase === 'transcribing' || phase === 'drafting';
  const micLive = mic.live;
  const status = statusText({ phase, heard, mode, hasPending: pending !== null, micLive });
  const notice = connectionNotice(connection);
  const canTalk = micLive && (connection.status === 'ready' || phase !== 'idle');
  const productList = products.data ?? [];
  const customerList = (customers.data ?? []).map((c) => c.customer);
  const confirmable = draft !== null && pending !== null && pending.draftId === draft.draftId;

  const change = (next: DraftMessage) => controller.editDraft(next);

  const applyTranscriptEdit = () => {
    if (!draft) return;
    const catalogCustomers = (customers.data ?? []).map(({ customer, balance }) => ({ id: customer.id, name: customer.name, aliases: customer.aliases, balance }));
    const rebuilt = draftFromTranscript(draft, editText, productList, catalogCustomers);
    if (rebuilt === null) {
      toast('Samajh nahi aaya. Doosre shabdon mein likho.', 'error');
      return;
    }
    controller.editDraft(rebuilt);
    setEditing(false);
  };

  const showCard = (d: DraftMessage) => {
    if (d.intent === 'query_balance') return <BalanceCard draft={d} repo={repo} />;
    if (d.intent === 'record_payment') return <PaymentCard draft={d} repo={repo} />;
    if (d.intent === 'create_bill') return <BillCard draft={d} products={productList} customers={customerList} onChange={change} />;
    return null;
  };

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-5.5rem)] max-w-md flex-col gap-3 px-4 pb-4 pt-5">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold tracking-tight">Bol-<span className="text-amber-400">Bill</span></h1>
        <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${connection.status === 'ready' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-stone-700 text-stone-200'}`}>
          <span className={`h-2 w-2 rounded-full ${connection.status === 'ready' ? 'bg-emerald-400' : 'bg-stone-400'}`} aria-hidden="true" />
          {!online ? 'Offline' : connection.status === 'ready' ? 'Online' : connection.status === 'limited' ? 'Busy' : 'Jud raha hai…'}
        </span>
      </header>

      {!online && <Notice title="Internet nahi hai" hint="Bolne ke liye internet chahiye. Khata aur samaan ab bhi khul sakte hain." />}
      {online && notice && <Notice title={notice.title} hint={notice.hint} />}
      {mic.status === 'error' && mic.error && <Notice tone="error" {...micErrorText(mic.error)} action={{ label: 'Dobara try karo', run: () => void enable() }} />}
      {degraded.includes('tts_unavailable') && <Notice title="Awaaz abhi nahi aa rahi" hint="Text mode: jawab neeche screen par hai." />}
      {degraded.includes('llm_timeout') && <Notice title="Bill dhyaan se dekho" hint="Smart check time par nahi ho paya, isliye bill ek baar check kar lo." />}
      {error && (
        <Notice
          tone="error"
          {...friendlyError(error)}
          action={{ label: 'Theek hai', run: () => controller.dismissError() }}
        />
      )}

      <section className="flex flex-1 flex-col gap-3" aria-live="polite">
        {transcript && !editing && (
          <div className="flex items-start justify-between gap-2 rounded-xl bg-stone-900 px-4 py-3">
            <p className="text-lg text-stone-100">&ldquo;{transcript}&rdquo;</p>
            {draft && (draft.intent === 'create_bill' || draft.intent === 'record_payment') && (
              <button type="button" aria-label="Transcript theek karo (edit)" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-stone-700" onClick={() => { setEditText(transcript); setEditing(true); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3ZM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7Z" /></svg>
              </button>
            )}
          </div>
        )}
        {editing && (
          <form className="rounded-xl bg-stone-900 p-3" onSubmit={(e) => { e.preventDefault(); applyTranscriptEdit(); }}>
            <label className="text-sm text-stone-300" htmlFor="transcript-edit">Jo bola tha, theek karo (bill dobara banega)</label>
            <input id="transcript-edit" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-stone-800 px-3 text-lg" />
            <div className="mt-2 flex gap-2">
              <button type="submit" className="min-h-12 flex-1 rounded-xl bg-amber-400 font-bold text-stone-950">Bill dobara banao</button>
              <button type="button" className="min-h-12 rounded-xl bg-stone-700 px-4 font-semibold" onClick={() => setEditing(false)}>Raho</button>
            </div>
          </form>
        )}

        {draft ? showCard(draft) : null}

        {draft && (
          <p className="flex items-start gap-2 rounded-xl bg-stone-900/70 px-4 py-3 text-stone-200">
            <span aria-hidden="true">🔊</span>
            <span>{draft.replyText.join(' ')}</span>
          </p>
        )}

        {!draft && !transcript && !busy && !listening && !error && (
          <div className="rounded-2xl border border-dashed border-stone-700 p-5 text-center">
            <p className="text-lg font-semibold">Mic dabake aise bolo:</p>
            <ul className="mt-3 space-y-2 text-stone-300">
              {EXAMPLES.map((e) => <li key={e}>&ldquo;{e}&rdquo;</li>)}
            </ul>
          </div>
        )}
      </section>

      {confirmable && pending && (pending.intent === 'create_bill' || pending.intent === 'record_payment') && (
        <div className="flex gap-2">
          <button type="button" className="min-h-16 flex-1 rounded-2xl bg-emerald-500 text-xl font-extrabold text-stone-950 active:bg-emerald-400" onClick={() => controller.confirm()}>✓ Confirm</button>
          <button type="button" className="min-h-16 rounded-2xl bg-stone-700 px-6 text-xl font-bold active:bg-stone-600" onClick={() => controller.discard()}>Cancel</button>
        </div>
      )}

      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-semibold" role="status">{status}</p>
        {micLive ? (
          <MicButton
            listening={listening}
            latched={mode === 'latched'}
            busy={busy}
            disabled={!canTalk}
            label="Microphone: dabake bolo, ya tap karke shuru karo"
            level={session.level}
            buttonProps={buttonProps}
          />
        ) : (
          <button type="button" disabled={audioStarting} onClick={() => void enable()} className="min-h-16 rounded-2xl bg-amber-400 px-8 text-xl font-extrabold text-stone-950 disabled:opacity-60">
            {audioStarting ? 'Mic khul raha hai…' : '🎤 Mic chalu karo'}
          </button>
        )}
        <p className="text-sm text-stone-400">Dabake bolo, chhodo to bhej dega · ya ek tap se shuru, doosre tap se band</p>
      </div>

      {hud && <LatencyHud turns={turns} connection={connection} />}

      {replacement && pending && (
        <ReplaceDialog current={pending} incoming={replacement} onAccept={() => controller.acceptReplacement()} onKeep={() => controller.keepPending()} />
      )}
    </main>
  );
}
