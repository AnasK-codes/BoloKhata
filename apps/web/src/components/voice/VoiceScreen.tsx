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
import { useT, type Translate } from '@/lib/i18n';
import { useApp } from '../AppProvider';
import { useAccount } from '../AccountGate';
import { Icon } from '../Icon';
import { StateView } from '../StateView';
import { LanguageSheet } from '../LanguagePicker';
import { BillCard } from './BillCard';
import { ChatBubbles, ConversationSheet } from './ConversationSheet';
import { BalanceCard, CustomerCard, PaymentCard, ProductCard, ProductListCard, StockCard, SummaryCard } from './InfoCards';
import { LatencyHud } from './LatencyHud';
import { MicButton } from './MicButton';
import { QuickTiles } from './QuickTiles';
import { ReplaceDialog } from './ReplaceDialog';
import { Money } from './Money';


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
  const t = useT();
  const [code, setCode] = useState('');
  return (
    <form
      className="banner"
      data-tone="warn"
      onSubmit={(e) => { e.preventDefault(); if (code.trim()) onSubmit(code); }}
    >
      <span className="banner-ico"><Icon name="alert" size={18} /></span>
      <div>
        <label htmlFor="access-code"><strong>{t('voice.accessTitle')}</strong></label>
        <p>{t('voice.accessHint')}</p>
        <div className="mt-3 flex gap-2">
          <input id="access-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" className="min-h-11 min-w-0 flex-1 rounded-xl bg-inset px-3 text-lg" />
          <button type="submit" disabled={!code.trim()} className="btn-pill btn-solid disabled:opacity-40">{t('voice.accessSubmit')}</button>
        </div>
      </div>
    </form>
  );
}

/** The same hints as a swipeable row, for the home screen. Still not buttons. */
function ExampleChips() {
  const t = useT();
  const examples = [t('voice.example1'), t('voice.example2'), t('voice.example3')];
  return (
    <div>
      <p className="vs-section-title mb-2"><span>{t('voice.examplesTitle')}</span></p>
      <div className="vs-chips">{examples.map((example) => <span key={example}>&ldquo;{example}&rdquo;</span>)}</div>
    </div>
  );
}

/** Today's numbers at a glance; each tile that leads somewhere is a link. */
function TodayStrip({ stats }: { stats: { todaySales: number; todayBills: number; totalUdhaar: number } }) {
  const t = useT();
  return (
    <section className="vs-today num" aria-label={t('voice.todayTitle')}>
      <Link href="/bills" className="wide">
        <small>{t('info.salesToday')}</small>
        <strong>{rupees(stats.todaySales)}</strong>
      </Link>
      <Link href="/bills">
        <small>{t('info.billsMade')}</small>
        <strong>{stats.todayBills}</strong>
      </Link>
      <Link href="/ledger" className="col-span-2">
        <small>{t('info.totalOwed')}</small>
        <strong className={stats.totalUdhaar > 0 ? 'text-warn' : 'text-good'}>{rupees(stats.totalUdhaar)}</strong>
      </Link>
    </section>
  );
}

/** Examples are hints to read, not buttons: tapping one would fake a spoken turn. */
function Examples() {
  const t = useT();
  // What to say depends on the speech setting, not the interface language: these stay Hinglish
  // in English and Hinglish, and are written in Devanagari for the Hindi interface.
  const examples = [t('voice.example1'), t('voice.example2'), t('voice.example3')];
  return (
    <div className="vs-examples">
      <p>{t('voice.examplesTitle')}</p>
      {examples.map((example, i) => (
        <span key={example} className="vs-example" style={{ ['--i' as string]: i }}>&ldquo;{example}&rdquo;</span>
      ))}
    </div>
  );
}

function KhataLink({ total, count }: { total: number; count: number }) {
  const t = useT();
  return (
    <Link href="/ledger" className="vs-khata">
      <span className="vs-tile-ico"><Icon name="book" size={20} /></span>
      <span>
        <strong>{t('nav.ledger')}</strong>
        <small>{count === 0 ? t('voice.khataNone') : t('voice.khataOwing', { count })}</small>
      </span>
      {count > 0 && <span className="amt num">{rupees(total)}</span>}
      <span className="chev"><Icon name="chevron" size={20} /></span>
    </Link>
  );
}

function connectionBadge(t: Translate, online: boolean, connection: ConnectionState): { tone: 'ok' | 'wait' | 'bad'; label: string } {
  if (!online) return { tone: 'bad', label: t('conn.offline') };
  switch (connection.status) {
    case 'ready': return { tone: 'ok', label: t('conn.online') };
    case 'limited': return { tone: 'wait', label: t('conn.busy') };
    case 'blocked': return { tone: 'bad', label: t('conn.blocked') };
    case 'closed': return { tone: 'bad', label: t('conn.closed') };
    default: return { tone: 'wait', label: t('conn.connecting') };
  }
}

export function VoiceScreen() {
  const t = useT();
  const { session, repo, dataError } = useApp();
  if (dataError) return <main className="mx-auto max-w-md px-4 py-10"><Notice tone="error" title={t('common.dataError')} hint={dataError} /></main>;
  if (!session || !repo) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center px-4" aria-busy="true">
        <StateView kind="loading" title={t('common.starting')} />
      </main>
    );
  }
  return <Voice session={session} repo={repo} />;
}

function Voice({ session, repo }: { session: NonNullable<ReturnType<typeof useApp>['session']>; repo: NonNullable<ReturnType<typeof useApp>['repo']> }) {
  const t = useT();
  const { toast } = useApp();
  const { profile } = useAccount();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const closeLanguage = useCallback(() => setLanguageOpen(false), []);
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
  const conversation = useTurnStore(store, (s) => s.conversation);
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
  const shopStats = useLive(() => repo.getShopStats(), [repo]);
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
      toast(t('voice.micFailed'), 'error');
    } finally {
      setAudioStarting(false);
    }
  }, [session, toast, t]);

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
      toast(t('voice.finishDraftFirst'), 'error');
    }
  };

  const applyTranscriptEdit = () => {
    if (!draft) return;
    const catalogCustomers = (customers.data ?? []).map(({ customer, balance }) => ({ id: customer.id, name: customer.name, aliases: customer.aliases, balance }));
    const rebuilt = draftFromTranscript(draft, editText, productList, catalogCustomers);
    if (rebuilt === null) {
      toast(t('voice.notUnderstood'), 'error');
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
    if (d.intent === 'add_products') return <ProductListCard draft={d} saved={pending?.draftId !== d.draftId && !d.clarification} onChange={change} />;
    if (d.intent === 'add_customer') return <CustomerCard draft={d} saved={pending?.draftId !== d.draftId} />;
    if (d.intent === 'create_bill') return <BillCard draft={d} products={productList} customers={customerList} repo={repo} onChange={change} />;
    return null;
  };

  const badge = connectionBadge(t, online, connection);
  // statusText cannot see the link; when the mic is locked because the gateway is not ready, say so instead of "Dabake bolo".
  const shownStatus = micLive && !canTalk ? t('voice.waitingConnection') : status;
  const owing = (customers.data ?? []).filter((c) => c.balance > 0);
  const owedTotal = owing.reduce((sum, c) => sum + c.balance, 0);
  const initial = (profile.businessName.trim()[0] ?? 'B').toUpperCase();
  const idleEmpty = !draft && !transcript && !busy && !listening && !error;
  const speakingNow = phase === 'speaking';

  return (
    <main className="vs">
      <div className="vs-col">
        <header className="vs-top">
          <Link href="/settings" className="vs-shop" aria-label={t('voice.shopProfile', { name: profile.businessName })}>
            <span className="vs-monogram" aria-hidden="true">{initial}</span>
            <span>
              <strong>{profile.businessName}</strong>
              <span className="vs-conn" data-tone={badge.tone}><i aria-hidden="true" />{badge.label}</span>
            </span>
          </Link>
          <div className="vs-top-actions">
            <button type="button" className="vs-icon-btn relative" aria-label={t('history.open')} aria-haspopup="dialog" onClick={() => setHistoryOpen(true)}>
              <Icon name="chat" size={20} />
              {conversation.length > 0 && <span className="vs-dot" aria-hidden="true" />}
            </button>
            <button type="button" className="vs-icon-btn" aria-label={t('lang.button')} aria-haspopup="dialog" onClick={() => setLanguageOpen(true)}><Icon name="globe" size={20} /></button>
            <Link href="/ledger" className="vs-icon-btn max-[480px]:hidden" aria-label={t('nav.ledger')}><Icon name="book" size={20} /></Link>
            <Link href="/settings" className="vs-icon-btn" aria-label={t('nav.settings')}><Icon name="gear" size={20} /></Link>
          </div>
        </header>

        <section className="vs-stage" aria-live="polite">
          {!online && <Notice title={t('notice.offlineTitle')} hint={t('notice.offlineHint')} />}
          {online && connection.status === 'blocked' && connection.reason === 'access_code_required' ? (
            <AccessCodeForm onSubmit={(code) => { setAccessCode(code); session.client.connect(); }} />
          ) : (
            online && notice && <Notice title={notice.title} hint={notice.hint} />
          )}
          {mic.status === 'error' && mic.error && <Notice tone="error" {...micErrorText(mic.error)} action={{ label: t('common.retry'), run: () => void enable() }} />}
          {degraded.includes('tts_unavailable') && <Notice title={t('notice.ttsTitle')} hint={t('notice.ttsHint')} />}
          {degraded.includes('llm_timeout') && <Notice title={t('notice.llmTitle')} hint={t('notice.llmHint')} />}
          {error && (
            <Notice
              tone="error"
              {...friendlyError(error)}
              action={{ label: t('common.ok'), run: () => controller.dismissError() }}
            />
          )}

          {idleEmpty && (
            <div className="vs-hero">
              <p className="vs-greet">{t('voice.greeting', { name: profile.businessName })}</p>
              <h1>{t('voice.helloTitle')}</h1>
              <p>{t('voice.helloHint')}</p>
            </div>
          )}
          {idleEmpty && shopStats.data && <TodayStrip stats={shopStats.data} />}
          {idleEmpty && <div className="hide-wide"><ExampleChips /></div>}
          {idleEmpty && conversation.length > 0 && (
            <section className="vs-recent" aria-label={t('history.recent')}>
              <p className="vs-section-title"><span>{t('history.recent')}</span></p>
              <ol className="chat-list">{conversation.slice(-2).map((e) => <ChatBubbles key={e.turnId} entry={e} />)}</ol>
              {conversation.length > 2 && <button type="button" className="more" onClick={() => setHistoryOpen(true)}>{t('history.seeAll', { count: conversation.length })}</button>}
            </section>
          )}

          {listening && !transcript && (
            <span className="bubble-live" role="status" aria-label={t('voice.listening')}><i /><i /><i /></span>
          )}

          {transcript && !editing && (
            <div className="bubble-me">
              {draft && (draft.intent === 'create_bill' || draft.intent === 'record_payment') && (
                <button type="button" aria-label={t('voice.editTranscript')} onClick={() => { setEditText(transcript); setEditing(true); }}>
                  <Icon name="pencil" size={18} />
                </button>
              )}
              <p>&ldquo;{transcript}&rdquo;</p>
            </div>
          )}
          {editing && (
            <form className="bill" onSubmit={(e) => { e.preventDefault(); applyTranscriptEdit(); }}>
              <label className="text-sm font-semibold text-muted" htmlFor="transcript-edit">{t('voice.editLabel')}</label>
              <input id="transcript-edit" autoFocus value={editText} onChange={(e) => setEditText(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl bg-inset px-3 text-lg" />
              <div className="mt-3 flex gap-2">
                <button type="submit" className="btn-pill btn-solid flex-1">{t('voice.rebuild')}</button>
                <button type="button" className="btn-pill btn-soft" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
              </div>
            </form>
          )}

          {busy && !draft && (
            <div className="skel" role="status" aria-label={t('voice.makingBill')}>
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
              <p className="vs-section-title mb-2"><span>{t('voice.quickTitle')}</span><span className="font-normal">{t('voice.quickHint')}</span></p>
              <QuickTiles products={frequent.data ?? []} disabled={busy} onPick={pickTile} />
            </div>
          )}

          {!draft && !listening && !busy && customers.data && <div className="hide-wide"><KhataLink total={owedTotal} count={owing.length} /></div>}

          {hud && <div className="hide-wide"><LatencyHud turns={turns} connection={connection} /></div>}
        </section>

        <div className="vs-dock">
          <div className="vs-dock-glass">
            {confirmable && draft?.bill && (
              <p className="vs-total num"><span>{t('voice.total')}</span><strong><Money value={draft.bill.total} /></strong></p>
            )}
            <p className="vs-status" role="status">
              {listening && <span className="rec-pill"><i aria-hidden="true" />{t('voice.rec')}</span>}
              <span key={shownStatus}>{shownStatus}</span>
            </p>
            {!confirmable && !draft && !listening && !busy && !error && canTalk && (
              <p className="vs-hint">{t('voice.idleHint')}</p>
            )}
            {micLive ? (
              <div className="vs-row">
                <div className="flex justify-end">
                  {confirmable && pending && (
                    <button type="button" className="vs-act vs-act-no" onClick={() => controller.discard()}>
                      <Icon name="close" size={22} />
                      {t('common.no')}
                    </button>
                  )}
                </div>
                <MicButton
                  listening={listening}
                  busy={busy}
                  speaking={speakingNow}
                  disabled={!canTalk}
                  label={speakingNow ? t('voice.micInterrupt') : t('voice.micLabel')}
                  level={session.level}
                  buttonProps={buttonProps}
                />
                <div className="flex justify-start">
                  {confirmable && pending && (
                    <button type="button" className="vs-act vs-act-yes" onClick={() => controller.confirm()}>
                      <Icon name="check" size={24} />
                      {t('voice.yesSave')}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" disabled={audioStarting} onClick={() => void enable()} className="vs-start">
                <Icon name="mic" size={22} />{audioStarting ? t('voice.micStarting') : t('voice.micStart')}
              </button>
            )}
            <p className="vs-credit">{t('voice.credit')}</p>
          </div>
        </div>
      </div>

      <aside className="vs-aside" aria-label={t('voice.shortcuts')}>
        <Examples />
        {customers.data && <KhataLink total={owedTotal} count={owing.length} />}
        {hud && <LatencyHud turns={turns} connection={connection} />}
      </aside>

      {languageOpen && <LanguageSheet onClose={closeLanguage} />}
      {historyOpen && <ConversationSheet entries={conversation} onClear={() => controller.clearHistory()} onClose={closeHistory} />}

      {replacement && pending && (
        <ReplaceDialog current={pending} incoming={replacement} onAccept={() => controller.acceptReplacement()} onKeep={() => controller.keepPending()} />
      )}
    </main>
  );
}
