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
import { Money } from './Money';

const EXAMPLES = ['Do kilo chawal 110 rupaye aur do packet Maggi 28 rupaye', 'Sharma ji ka kitna udhaar hai?', 'Verma ji ne do sau de diye', 'Aaj kitni bikri hui?', 'Ramesh Kumar ko customer mein add karo', 'Samaan mein Maida 35 rupaye kilo add karo'];

function Notice({ title, hint, tone = 'warn', action }: { title: string; hint: string; tone?: 'warn' | 'error'; action?: { label: string; run(): void } }) {
  return (
    <div role="alert" className="banner" data-tone={tone}>
      <span className="banner-ico"><Icon name="alert" size={18} /></span>
      <div>
        <strong>{title}</strong>
        <p>{hint}</p>
        {action && <button type="button" onClick={action.run} className="btn-pill btn-soft">{action.label}</button>}
      </div>
    </div>
  );
}

function AccessCodeForm({ onSubmit }: { onSubmit(code: string): void }) {
  const [code, setCode] = useState('');
  return (
    <form
      className="banner"
      data-tone="warn"
      onSubmit={(e) => { e.preventDefault(); if (code.trim()) onSubmit(code); }}
    >
      <span className="banner-ico"><Icon name="alert" size={18} /></span>
      <div>
        <label htmlFor="access-code"><strong>Demo code chahiye</strong></label>
        <p>Post ya README mein diya gaya code likho. (Enter the demo access code.)</p>
        <div className="mt-3 flex gap-2">
          <input id="access-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-xl bg-inset px-3 text-lg" />
          <button type="submit" disabled={!code.trim()} className="btn-pill btn-solid disabled:opacity-40">Shuru</button>
        </div>
      </div>
    </form>
  );
}

/** Examples are hints to read, not buttons: tapping one would fake a spoken turn. */
function Examples() {
  return (
    <div className="vs-examples" aria-label="Aise bolo (examples)">
      <p>Aise bolkar dekho</p>
      {EXAMPLES.slice(0, 3).map((example, i) => (
        <span key={example} className="vs-example" style={{ ['--i' as string]: i }}>&ldquo;{example}&rdquo;</span>
      ))}
    </div>
  );
}

function KhataLink({ total, count }: { total: number; count: number }) {
  return (
    <Link href="/ledger" className="vs-khata">
      <span className="vs-tile-ico"><Icon name="book" size={20} /></span>
      <span>
        <strong>Khata</strong>
        <small>{count === 0 ? 'Abhi koi udhaar nahi' : `${count} grahak ka udhaar baaki`}</small>
      </span>
      {count > 0 && <span className="amt num">{rupees(total)}</span>}
      <span className="chev"><Icon name="chevron" size={20} /></span>
    </Link>
  );
}

function connectionBadge(online: boolean, connection: ConnectionState): { tone: 'ok' | 'wait' | 'bad'; label: string } {
  if (!online) return { tone: 'bad', label: 'Offline' };
  switch (connection.status) {
    case 'ready': return { tone: 'ok', label: 'Online' };
    case 'limited': return { tone: 'wait', label: 'Busy, thoda ruko' };
    case 'blocked': return { tone: 'bad', label: 'Code chahiye' };
    case 'closed': return { tone: 'bad', label: 'Disconnected' };
    default: return { tone: 'wait', label: 'Jud raha hai…' };
  }
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

  const badge = connectionBadge(online, connection);
  // statusText cannot see the link; when the mic is locked because the gateway is not ready, say so instead of "Dabake bolo".
  const shownStatus = micLive && !canTalk ? 'Connection ka intezaar…' : status;
  const owing = (customers.data ?? []).filter((c) => c.balance > 0);
  const owedTotal = owing.reduce((sum, c) => sum + c.balance, 0);
  const initial = (profile.businessName.trim()[0] ?? 'B').toUpperCase();
  const idleEmpty = !draft && !transcript && !busy && !listening && !error;
  const speakingNow = phase === 'speaking';

  return (
    <main className="vs">
      <div className="vs-col">
        <header className="vs-top">
          <Link href="/settings" className="vs-shop" aria-label={`${profile.businessName}: dukaan profile`}>
            <span className="vs-monogram" aria-hidden="true">{initial}</span>
            <span>
              <strong>{profile.businessName}</strong>
              <span className="vs-conn" data-tone={badge.tone}><i aria-hidden="true" />{badge.label}</span>
            </span>
          </Link>
          <div className="vs-top-actions">
            <Link href="/ledger" className="vs-icon-btn" aria-label="Khata (ledger)"><Icon name="book" size={20} /></Link>
            <Link href="/settings" className="vs-icon-btn" aria-label="Settings"><Icon name="gear" size={20} /></Link>
          </div>
        </header>

        <section className="vs-stage" aria-live="polite">
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

          {idleEmpty && (
            <div className="vs-hello">
              <h1>Aaj kya bill banana hai?</h1>
              <p>Mic dabake bolo. Samaan, quantity aur price hum likh lenge.</p>
            </div>
          )}
          {idleEmpty && <div className="hide-wide"><Examples /></div>}

          {listening && !transcript && (
            <span className="bubble-live" role="status" aria-label="Sun raha hoon"><i /><i /><i /></span>
          )}

          {transcript && !editing && (
            <div className="bubble-me">
              {draft && (draft.intent === 'create_bill' || draft.intent === 'record_payment') && (
                <button type="button" aria-label="Transcript theek karo (edit)" onClick={() => { setEditText(transcript); setEditing(true); }}>
                  <Icon name="pencil" size={18} />
                </button>
              )}
              <p>&ldquo;{transcript}&rdquo;</p>
            </div>
          )}
          {editing && (
            <form className="bill" onSubmit={(e) => { e.preventDefault(); applyTranscriptEdit(); }}>
              <label className="text-sm font-semibold text-muted" htmlFor="transcript-edit">Jo bola tha, theek karo (bill dobara banega)</label>
              <input id="transcript-edit" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl bg-inset px-3 text-lg" />
              <div className="mt-3 flex gap-2">
                <button type="submit" className="btn-pill btn-solid flex-1">Bill dobara banao</button>
                <button type="button" className="btn-pill btn-soft" onClick={() => setEditing(false)}>Raho</button>
              </div>
            </form>
          )}

          {busy && !draft && (
            <div className="skel" role="status" aria-label="Bill ban raha hai">
              <i style={{ width: '42%' }} />
              <i style={{ width: '86%' }} />
              <i style={{ width: '70%' }} />
            </div>
          )}

          {draft ? showCard(draft) : null}

          {draft && draft.replyText.length > 0 && (
            <p className="bubble-bot">
              <Icon name="speaker" size={18} />
              <span>
                {draft.replyText.join(' ')}
                {speakingNow && <span className="speak-wave" aria-hidden="true"><i /><i /><i /><i /></span>}
              </span>
            </p>
          )}

          {!listening && (frequent.data ?? []).length > 0 && (
            <div>
              <p className="vs-section-title mb-2"><span>Jaldi chuno</span><span className="font-normal">tap = bill mein</span></p>
              <QuickTiles products={frequent.data ?? []} disabled={busy} onPick={pickTile} />
            </div>
          )}

          {!draft && !listening && !busy && customers.data && <div className="hide-wide"><KhataLink total={owedTotal} count={owing.length} /></div>}

          {hud && <div className="hide-wide"><LatencyHud turns={turns} connection={connection} /></div>}
        </section>

        <div className="vs-dock">
          <div className="vs-dock-glass">
            {confirmable && draft?.bill && (
              <p className="vs-total num"><span>Total</span><strong><Money value={draft.bill.total} /></strong></p>
            )}
            <p className="vs-status" role="status">
              {listening && <span className="rec-pill"><i aria-hidden="true" />REC</span>}
              <span key={shownStatus}>{shownStatus}</span>
            </p>
            {!confirmable && !draft && !listening && !busy && !error && canTalk && (
              <p className="vs-hint">Chhodte hi bill banega · ya tap karke bolo</p>
            )}
            {micLive ? (
              <div className="vs-row">
                <div className="flex justify-end">
                  {confirmable && pending && (
                    <button type="button" className="vs-act vs-act-no" onClick={() => controller.discard()}>
                      <Icon name="close" size={22} />
                      Nahi
                    </button>
                  )}
                </div>
                <MicButton
                  listening={listening}
                  busy={busy}
                  speaking={speakingNow}
                  disabled={!canTalk}
                  label={speakingNow ? 'Microphone: dabao, awaaz ruk jayegi aur aap bol sakte hain' : 'Microphone: dabake bolo, ya tap karke shuru karo'}
                  level={session.level}
                  buttonProps={buttonProps}
                />
                <div className="flex justify-start">
                  {confirmable && pending && (
                    <button type="button" className="vs-act vs-act-yes" onClick={() => controller.confirm()}>
                      <Icon name="check" size={24} />
                      Haan, save
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" disabled={audioStarting} onClick={() => void enable()} className="vs-start">
                <Icon name="mic" size={22} />{audioStarting ? 'Mic khul raha hai…' : 'Mic chalu karo'}
              </button>
            )}
            <p className="vs-credit">Speech: <b>Gnani Prisma</b> STT · <b>Gnani Timbre</b> TTS</p>
          </div>
        </div>
      </div>

      <aside className="vs-aside" aria-label="Shortcuts">
        <Examples />
        {customers.data && <KhataLink total={owedTotal} count={owing.length} />}
        {hud && <LatencyHud turns={turns} connection={connection} />}
      </aside>

      {replacement && pending && (
        <ReplaceDialog current={pending} incoming={replacement} onAccept={() => controller.acceptReplacement()} onKeep={() => controller.keepPending()} />
      )}
    </main>
  );
}
