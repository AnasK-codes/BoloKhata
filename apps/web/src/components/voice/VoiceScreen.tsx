'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { hasCreditDetails, type DraftMessage, type Product } from '@bolbill/shared';
import { setAccessCode } from '@/lib/accessCode';
import { rupees } from '@/lib/format';
import { useLive } from '@/lib/db/live';
import { useHoldOrLatch } from '@/lib/gesture/useHoldOrLatch';
import type { MicState } from '@/lib/audio/micCapture';
import type { ConnectionState } from '@/lib/realtime/types';
import { useSettings } from '@/lib/settings';
import { useOnline } from '@/lib/useOnline';
import { useTurnStore } from '@/lib/turn/useTurnStore';
import { addProductToDraft, billFromProduct, draftFromTranscript } from '@/lib/voice/draftEdit';
import { connectionNotice, friendlyError, micErrorText } from '@/lib/voice/errorText';
import { statusText } from '@/lib/voice/statusText';
import { useApp } from '../AppProvider';
import { useAccount } from '../AccountGate';
import { Icon } from '../Icon';
import { StateView } from '../StateView';
import { BillCard } from './BillCard';
import { BalanceCard, CustomerCard, PaymentCard, ProductCard, ProductListCard, StockCard, SummaryCard } from './InfoCards';
import { LatencyHud } from './LatencyHud';
import { MicButton } from './MicButton';
import { QuickTiles } from './QuickTiles';
import { ReplaceDialog } from './ReplaceDialog';

const EXAMPLES = ['Do kilo chawal 110 rupaye aur do packet Maggi 28 rupaye', 'Sharma ji ka kitna udhaar hai?', 'Verma ji ne do sau de diye', 'Aaj kitni bikri hui?', 'Ramesh Kumar ko customer mein add karo', 'Samaan mein Maida 35 rupaye kilo add karo'];

function Notice({ title, hint, tone = 'warn', action }: { title: string; hint: string; tone?: 'warn' | 'error'; action?: { label: string; run(): void } }) {
  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 ${tone === 'error' ? 'border-bad/70 bg-bad/10' : 'border-warn/60 bg-warn/10'}`}>
      <p className="font-bold">{title}</p>
      <p className="text-ink">{hint}</p>
      {action && <button type="button" onClick={action.run} className="mt-2 min-h-12 rounded-xl bg-control px-4 font-semibold">{action.label}</button>}
    </div>
  );
}

function AccessCodeForm({ onSubmit }: { onSubmit(code: string): void }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="rounded-xl border border-warn/60 bg-warn/10 px-4 py-3"
      onSubmit={(e) => { e.preventDefault(); if (code.trim()) onSubmit(code); }}
    >
      <label htmlFor="access-code" className="font-bold">Demo code chahiye</label>
      <p className="text-ink">Post ya README mein diya gaya code likho. (Enter the demo access code.)</p>
      <div className="mt-2 flex gap-2">
        <input id="access-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="min-h-12 min-w-0 flex-1 rounded-xl bg-inset px-3 text-lg" />
        <button type="submit" disabled={!code.trim()} className="min-h-12 rounded-xl bg-accent px-5 font-bold text-on-solid disabled:opacity-40">Shuru</button>
      </div>
    </form>
  );
}

export function VoiceScreen() {
  const { session, repo, dataError } = useApp();
  if (dataError) return <main className="mx-auto max-w-md px-4 py-10"><Notice tone="error" title="Data nahi khul paya" hint={dataError} /></main>;
  if (!session || !repo) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4" aria-busy="true">
        <StateView kind="loading" title="Shuru ho raha hai" />
      </main>
    );
  }
  return <Voice session={session} repo={repo} />;
}

function Voice({ session, repo }: { session: NonNullable<ReturnType<typeof useApp>['session']>; repo: NonNullable<ReturnType<typeof useApp>['repo']> }) {
  const { toast } = useApp();
  const { profile } = useAccount();
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
  const frequent = useLive(() => repo.listFrequentProducts(8), [repo]);
  useEffect(() => {
    if (!draft?.bill || draft.bill.udhaar <= 0 || !draft.customer || !customers.data) return;
    const ready = hasCreditDetails(customers.data.find((c) => c.customer.id === draft.customer?.id)?.customer);
    if (draft.customer.creditReady !== ready) controller.editDraft({ ...draft, customer: { ...draft.customer, creditReady: ready } });
  }, [draft, customers.data, controller]);

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

  /** A quick tile adds to the bill on screen, or starts a new one when nothing is waiting. */
  const pickTile = (product: Product) => {
    if (pending && pending.intent === 'create_bill' && draft?.draftId === pending.draftId) {
      controller.editDraft(addProductToDraft(draft, product));
    } else if (pending === null) {
      controller.startDraft(billFromProduct(product, globalThis.crypto.randomUUID(), 0));
    } else {
      toast('Pehle jo draft hai use confirm ya cancel karo.', 'error');
    }
  };

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
    if (d.intent === 'record_payment') return <PaymentCard draft={d} repo={repo} saved={pending?.draftId !== d.draftId} />;
    if (d.intent === 'query_summary') return <SummaryCard draft={d} />;
    if (d.intent === 'out_of_stock') return <StockCard draft={d} saved={pending?.draftId !== d.draftId} />;
    if (d.intent === 'add_product' || d.intent === 'update_price') return <ProductCard draft={d} saved={pending?.draftId !== d.draftId} />;
    if (d.intent === 'add_products') return <ProductListCard draft={d} saved={pending?.draftId !== d.draftId} />;
    if (d.intent === 'add_customer') return <CustomerCard draft={d} saved={pending?.draftId !== d.draftId} />;
    if (d.intent === 'create_bill') return <BillCard draft={d} products={productList} customers={customerList} repo={repo} onChange={change} />;
    return null;
  };

  return (
    <main className="voice-page">
      <header className="voice-header">
        <Link href="/settings" className="shop-profile"><span className="shop-avatar"><Icon name="user" size={22} /></span><span><small>Namaste, welcome back</small><strong>{profile.businessName}</strong></span></Link>
        <span className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-sm font-semibold ${connection.status === 'ready' ? 'bg-good/15 text-good' : 'bg-control text-ink'}`}>
          <span className={`h-2 w-2 rounded-full ${connection.status === 'ready' ? 'bg-good' : 'bg-muted'}`} aria-hidden="true" />
          {!online ? 'Offline' : connection.status === 'ready' ? 'Online' : connection.status === 'limited' ? 'Busy' : 'Jud raha hai…'}
        </span>
      </header>
      <div className="voice-heading"><p className="eyebrow">YOUR EVERYDAY BILLING ASSISTANT</p><h1>Aaj kya bill<br className="sm:hidden" /> banana hai?</h1><p>Bas bolo. Samaan, quantity aur price hum likh lenge.</p></div>
      {pending?.bill && <p className="text-sm text-muted">Badalna hai? Bolo: “Aata teen kilo karo”, “Maggi hata do”, “Ek Maggi aur jodo”.</p>}

      {!online && <Notice title="Internet nahi hai" hint="Bolne ke liye internet chahiye. Khata aur samaan ab bhi khul sakte hain." />}
      {online && connection.status === 'blocked' && connection.reason === 'access_code_required' ? (
        <AccessCodeForm onSubmit={(code) => { setAccessCode(code); session.client.connect(); }} />
      ) : (
        online && notice && <Notice title={notice.title} hint={notice.hint} />
      )}
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

      <div className="voice-workspace">
      <div className="voice-main">
      <div className="workspace-caption"><strong>Naya bill / New bill</strong><span>VOICE WORKSPACE</span></div>
      <section className="voice-results" aria-live="polite">
        {transcript && !editing && (
          <div className="flex items-start justify-between gap-2 rounded-xl bg-inset px-4 py-3">
            <p className="text-lg text-ink">&ldquo;{transcript}&rdquo;</p>
            {draft && (draft.intent === 'create_bill' || draft.intent === 'record_payment') && (
              <button type="button" aria-label="Transcript theek karo (edit)" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-control" onClick={() => { setEditText(transcript); setEditing(true); }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3ZM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7Z" /></svg>
              </button>
            )}
          </div>
        )}
        {editing && (
          <form className="rounded-xl bg-inset p-3" onSubmit={(e) => { e.preventDefault(); applyTranscriptEdit(); }}>
            <label className="text-sm text-dim" htmlFor="transcript-edit">Jo bola tha, theek karo (bill dobara banega)</label>
            <input id="transcript-edit" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} className="mt-1 min-h-12 w-full rounded-xl bg-raised px-3 text-lg" />
            <div className="mt-2 flex gap-2">
              <button type="submit" className="min-h-12 flex-1 rounded-xl bg-accent font-bold text-on-solid">Bill dobara banao</button>
              <button type="button" className="min-h-12 rounded-xl bg-control px-4 font-semibold" onClick={() => setEditing(false)}>Raho</button>
            </div>
          </form>
        )}

        <QuickTiles products={frequent.data ?? []} disabled={listening || busy} onPick={pickTile} />

        {draft ? showCard(draft) : null}

        {draft && (
          <p className="flex items-start gap-2 rounded-xl bg-inset/70 px-4 py-3 text-ink">
            <Icon name="speaker" size={22} />
            <span>{draft.replyText.join(' ')}</span>
          </p>
        )}

        {!draft && !transcript && !busy && !listening && !error && (
          <div className="voice-welcome">
            <span className="assistant-emblem"><Icon name="mic" size={34} /></span>
            <p className="eyebrow">BOL-BILL, AAPKE SAATH</p>
            <h2>Aap bolo,<br />bill taiyaar.</h2>
            <p>Item ki price bhi bol sakte ho.<br />Save karne se pehle bill check kar lena.</p>
            <div className="welcome-tags"><span>Voice billing</span><span>Khata</span><span>Print & share</span></div>
          </div>
        )}
      </section>

      <div className={`voice-controls ${draft ? 'has-draft' : ''}`}>
        {confirmable && draft?.bill && (
          <p className="num flex w-full items-baseline justify-between text-2xl font-extrabold">
            <span>Total</span>
            <span>{rupees(draft.bill.total)}</span>
          </p>
        )}
        <p className="text-lg font-semibold" role="status">{status}</p>
        {confirmable && <p className="text-sm text-dim">Ya bolo: <strong>&ldquo;haan&rdquo;</strong> save ke liye, <strong>&ldquo;nahi&rdquo;</strong> cancel ke liye</p>}
        {micLive ? (
          <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
            <div>
              {confirmable && pending && (
                <button type="button" className="flex min-h-16 w-full flex-col items-center justify-center rounded-2xl border-2 border-line bg-control text-base font-bold active:bg-raised" onClick={() => controller.discard()}>
                  <Icon name="stop" size={20} />
                  Nahi
                </button>
              )}
            </div>
            <MicButton
              listening={listening}
              busy={busy}
              speaking={phase === 'speaking'}
              disabled={!canTalk}
              label={phase === 'speaking' ? 'Microphone: dabao, awaaz ruk jayegi aur aap bol sakte hain' : 'Microphone: dabake bolo, ya tap karke shuru karo'}
              level={session.level}
              buttonProps={buttonProps}
            />
            <div>
              {confirmable && pending && (
                <button type="button" className="flex min-h-16 w-full flex-col items-center justify-center rounded-2xl bg-good text-base font-extrabold text-on-solid active:brightness-110" onClick={() => controller.confirm()}>
                  <Icon name="check" size={24} />
                  Haan, save
                </button>
              )}
            </div>
          </div>
        ) : (
          <button type="button" disabled={audioStarting} onClick={() => void enable()} className="voice-start">
            <span className="flex items-center gap-2"><Icon name="mic" size={24} />{audioStarting ? 'Mic khul raha hai…' : 'Mic chalu karo'}</span>
          </button>
        )}
        {!draft && !listening && !busy && <p className="text-center text-sm text-muted">Dabake bolo, chhodo to bhej dega · ya ek tap se shuru, doosre tap se band</p>}
      </div>
      </div>
      <aside className="voice-sidebar">
        <div className="quick-card"><div className="section-heading"><h2>Dukaan ke shortcuts</h2><span>↗</span></div><div className="quick-links">
          <Link href="/bills"><span className="shortcut-icon lavender">▤</span><strong>Saved bills</strong><small>Dekho, print aur share karo</small></Link>
          <Link href="/ledger"><span className="shortcut-icon peach"><Icon name="user" /></span><strong>Customer khata</strong><small>Udhaar aur payments dekho</small></Link>
          <Link href="/catalog"><span className="shortcut-icon mint">▦</span><strong>Apna samaan</strong><small>Items aur rates manage karo</small></Link>
        </div></div>
        <div className="example-card"><p className="eyebrow">BOLKAR DEKHO</p><h2>Ek sentence. Kaam done.</h2><ul>{EXAMPLES.map((example, index) => <li key={example}><span>0{index + 1}</span><p>&ldquo;{example}&rdquo;</p></li>)}</ul></div>
        <Link href="/settings" className="profile-banner"><Icon name="check" size={26} /><span><strong>Aapki dukaan, aapka bill.</strong><small>Business profile aur receipt details</small></span><span aria-hidden="true">↗</span></Link>
      </aside>
      </div>

      {hud && <LatencyHud turns={turns} connection={connection} />}

      {replacement && pending && (
        <ReplaceDialog current={pending} incoming={replacement} onAccept={() => controller.acceptReplacement()} onKeep={() => controller.keepPending()} />
      )}
    </main>
  );
}
