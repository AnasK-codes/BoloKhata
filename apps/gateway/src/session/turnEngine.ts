import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import {
  CatalogIndex,
  TTS_PCM_FORMAT,
  answerFollowUp,
  buildBill,
  cancelled,
  clarifyAsk,
  correctDraft,
  isConfirmable,
  repeatClarification,
  type DraftMessage,
  type ErrorCode,
} from '@bolbill/shared';
import type { GatewayConfig } from '../config';
import type { SttLink, SttTranscript } from '../gnani/sttLink';
import type { TtsLink } from '../gnani/ttsLink';
import type { CreditGuard } from '../guard/creditGuard';
import type { Metrics } from '../metrics';
import type { Orchestrator, ParseOutcome } from '../parse/orchestrator';
import { resolveUtterance } from '../parse/resolve';
import type { TurnTimer } from '../timing';
import { buildDraft, type Catalog, type PendingDraft } from './draftBuilder';
import type { SendQueue } from './sendQueue';

export type { Catalog };

export interface TurnEngineDeps {
  config: GatewayConfig;
  log: FastifyBaseLogger;
  guard: CreditGuard;
  metrics: Metrics;
  out: SendQueue;
  timer: TurnTimer;
  stt: SttLink;
  tts: TtsLink;
  orchestrator: Orchestrator;
  newDraftId?: () => string;
}

/** Everything about the press currently being handled. Replaced by the next press. */
interface TurnContext {
  turnId: number;
  /** Cancels a model call in flight when the turn is interrupted or superseded. */
  abort: AbortController;
  /** Set once the turn is interrupted or superseded: nothing more may be sent for it. */
  cancelled: boolean;
}

/**
 * The lifecycle of one press (README section 4), for one session:
 *
 *   ptt_start  -> arm STT, supersede whatever was happening (silence TTS, cancel the old turn)
 *   frames     -> paced to Gnani; wrong sizes are dropped upstream of this class
 *   ptt_end    -> drain and commit
 *   transcript -> `transcript` message, then the orchestrator (rules, LLM only if needed)
 *   draft      -> `draft` message at once, then the spoken reply starts. It does not wait for the
 *                 user to confirm. The reply is spoken once, from the final draft.
 *
 * One turn at a time: a new press supersedes the old one. Every step after an `await` checks that
 * its turn is still current, so an interrupted or superseded turn cannot leak a message or audio.
 */
export class TurnEngine {
  private readonly config: GatewayConfig;
  private readonly log: FastifyBaseLogger;
  private readonly guard: CreditGuard;
  private readonly metrics: Metrics;
  private readonly out: SendQueue;
  private readonly timer: TurnTimer;
  private readonly stt: SttLink;
  private readonly tts: TtsLink;
  private readonly orchestrator: Orchestrator;
  private readonly newDraftId: () => string;

  private catalog: Catalog | null = null;
  private index: CatalogIndex | null = null;
  /** The press being captured or transcribed (frames are accepted only while this is set). */
  private activeTurn: number | null = null;
  private current: TurnContext | null = null;
  private pending: PendingDraft | null = null;
  private correctionContext: DraftMessage | null = null;
  private sttReserved = 0;
  private disposed = false;
  /** The turn whose `tts_end` went out most recently, so an interrupt does not send timing twice. */
  private lastEnded = -1;

  constructor(deps: TurnEngineDeps) {
    this.config = deps.config;
    this.log = deps.log;
    this.guard = deps.guard;
    this.metrics = deps.metrics;
    this.out = deps.out;
    this.timer = deps.timer;
    this.stt = deps.stt;
    this.tts = deps.tts;
    this.orchestrator = deps.orchestrator;
    this.newDraftId = deps.newDraftId ?? randomUUID;
    this.attachStt();
    this.attachTts();
  }

  /** The catalog snapshot changed (hello or context_update). The index is rebuilt, not mutated. */
  setCatalog(catalog: Catalog): void {
    this.catalog = catalog;
    this.index = new CatalogIndex(catalog.products, catalog.customers);
  }

  /** Hot path: one call per microphone frame. No allocation, no logging. */
  onAudioFrame(frame: Uint8Array): void {
    if (this.activeTurn !== null) this.stt.pushFrame(frame);
  }

  onPttStart(turnId: number, draftContext?: DraftMessage | null): void {
    if (draftContext !== undefined) {
      // The browser's draft (with local edits) replaces ours; it is confirmable by voice only if the
      // browser could save it, by the same shared rule.
      this.correctionContext = draftContext;
      this.pending = draftContext && isPendingIntent(draftContext.intent)
        ? { draftId: draftContext.draftId, intent: draftContext.intent, canConfirm: isConfirmable(draftContext) }
        : null;
    }
    this.tts.interruptAll(); // barge-in: pressing the button silences the shop's assistant
    this.supersedeCurrent();
    if (!this.guard.checkAndReserve('stt_seconds', this.config.gnani.stt.maxUtteranceSeconds)) {
      this.out.json({
        type: 'limit',
        reason: 'budget',
        message: "Today's demo budget is used up.",
        resetAt: this.guard.resetAt(),
      });
      return;
    }
    this.sttReserved = this.config.gnani.stt.maxUtteranceSeconds;
    this.activeTurn = turnId;
    this.current = {
      turnId,
      abort: new AbortController(),
      cancelled: false,
    };
    this.metrics.turnsTotal++;
    this.timer.start(turnId);
    this.out.markLive(turnId);
    this.stt.beginTurn(turnId);
    if (!this.stt.turnActive) this.settleCapture(0); // refused to start (for example, STT is down)
  }

  onPttEnd(turnId: number): void {
    if (turnId !== this.activeTurn) return;
    this.timer.mark(turnId, 'release');
    this.stt.endTurn();
  }

  /** Stops everything for the turn: capture, parsing, queued speech, speech in flight, late audio. */
  onInterrupt(turnId: number): void {
    this.out.markStale(turnId);
    this.lastEnded = -1;
    this.tts.interrupt(turnId);
    const ctx = this.current;
    if (ctx?.turnId === turnId) {
      this.cancel(ctx);
      if (this.activeTurn === turnId) this.releaseCapture();
    }
    // The client's acknowledgement that the turn is over. Speech in flight already sent one with its
    // `tts_end`; otherwise the spans recorded so far are the acknowledgement.
    if (this.lastEnded !== turnId) this.sendTiming(turnId);
  }

  /** Client-initiated speech (for example after a save). Same safety checks as any reply. */
  onSpeak(turnId: number, text: string): void {
    this.timer.ensure(turnId);
    this.out.markLive(turnId);
    // Client text may contain names, so it is never cached (the cache is for fixed phrases).
    if (!this.tts.speak(turnId, [text])) {
      this.out.json({
        type: 'error',
        turnId,
        code: 'BAD_MESSAGE',
        message: 'Nothing to say.',
        retryable: false,
      });
    }
  }

  /** The session is closing: cancel work in flight so nothing outlives it. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.current) this.cancel(this.current);
    this.releaseCapture();
    this.pending = null;
  }

  // ---- turn lifecycle ---------------------------------------------------------------------

  /** A new press (or an interrupt) ends the old turn: no more events, no more audio. */
  private supersedeCurrent(): void {
    const old = this.current;
    if (old) {
      this.out.markStale(old.turnId);
      this.cancel(old);
    }
    if (this.activeTurn !== null) this.releaseCapture();
  }

  private cancel(ctx: TurnContext): void {
    ctx.cancelled = true;
    ctx.abort.abort();
    if (this.current === ctx) this.current = null;
  }

  /** Abandons capture. The STT link reports its usage on the way out, which settles the reservation. */
  private releaseCapture(): void {
    this.stt.abortTurn();
    this.activeTurn = null;
  }

  /** Replaces the reserved estimate with the audio seconds really streamed. */
  private settleCapture(seconds: number): void {
    this.guard.record('stt_seconds', seconds, this.sttReserved);
    this.sttReserved = 0;
    this.activeTurn = null;
  }

  private onTranscript(t: SttTranscript): void {
    const ctx = this.current;
    if (!ctx || ctx.cancelled || ctx.turnId !== t.turnId) return;
    this.timer.mark(t.turnId, 'transcript');
    this.out.json({
      type: 'transcript',
      turnId: t.turnId,
      text: t.text,
      ...(t.language !== undefined ? { language: t.language } : {}),
      ...(t.sttMs !== undefined ? { sttMs: t.sttMs } : {}),
    });
    if (t.text.trim() === '') return;
    void this.respond(ctx, t.text);
  }

  /** Parse, build the draft, send it, and start speaking it. Never throws. */
  private async respond(ctx: TurnContext, transcript: string): Promise<void> {
    try {
      const catalog = this.catalog;
      const index = this.index;
      if (!catalog || !index) return;
      if (this.answerQuestion(ctx, transcript, catalog, index)) return;
      if (this.correctionContext?.bill) {
        const base = this.correctionContext;
        // Recompute totals before editing; catalog lines use current rates and quoted lines retain their validated price basis.
        const items = base.bill!.items.map((item) => ({
          name: item.spokenPrice ? item.name : catalog.products.find((p) => p.id === item.productId)?.name ?? '',
          quantity: item.quantity, unit: item.unit,
          ...(item.spokenPrice ? { spokenPrice: item.spokenPrice } : {}),
        }));
        const priced = buildBill({ parsedItems: items, products: index, amountPaid: base.bill!.udhaar === 0 ? null : base.bill!.paid,
          ...(base.bill!.adjust ? { adjust: base.bill!.adjust } : {}),
          ...(base.customer?.id ? { customerId: base.customer.id } : {}) });
        const correction = correctDraft({ ...base, bill: priced.bill,
          unresolved: [...base.unresolved, ...priced.unresolvedItems].slice(0, 10) }, transcript, catalog.products);
        if (correction) {
          const draft = { ...correction.draft, turnId: ctx.turnId, source: 'rules' as const };
          this.correctionContext = draft;
          this.pending = { draftId: draft.draftId, intent: 'create_bill', canConfirm: isConfirmable(draft) };
          this.timer.mark(ctx.turnId, 'rules_done');
          this.timer.setParseSource(ctx.turnId, 'rules');
          this.timer.mark(ctx.turnId, 'draft');
          this.out.json(draft);
          this.sendTiming(ctx.turnId);
          if (!this.tts.speak(ctx.turnId, draft.replyText)) this.reportError(ctx.turnId, 'TTS_UNAVAILABLE', 'Could not speak the reply.', true);
          return;
        }
      }
      const outcome = await this.orchestrator.parse({
        transcript,
        index,
        names: catalog,
        signal: ctx.abort.signal,
        mark: (span) => this.timer.mark(ctx.turnId, span),
      });
      if (ctx.cancelled) return; // interrupted or superseded while parsing

      this.timer.setParseSource(ctx.turnId, outcome.source);
      this.countLlm(outcome.llm);
      const result = buildDraft({
        turnId: ctx.turnId,
        outcome,
        catalog,
        pending: this.pending,
        draftId: this.newDraftId(),
        transcript,
      });
      if (result.draft.intent === 'create_bill') this.correctionContext = result.draft;
      if (result.pendingChange.action === 'set') this.pending = result.pendingChange.pending;
      else if (result.pendingChange.action === 'clear') this.pending = null;

      this.timer.mark(ctx.turnId, 'draft');
      this.out.json(result.draft);
      this.sendTiming(ctx.turnId);
      if (outcome.llm === 'timeout') {
        this.out.json({
          type: 'error',
          turnId: ctx.turnId,
          code: 'LLM_TIMEOUT',
          message: 'Smart understanding was slow, so this is the basic result.',
          retryable: false,
        });
      }
      // The reply starts now. It never waits for the user to confirm anything.
      if (!this.tts.speak(ctx.turnId, result.draft.replyText, { cache: result.cacheReply })) {
        this.reportError(ctx.turnId, 'TTS_UNAVAILABLE', 'Could not speak the reply.', true);
      }
    } catch (error) {
      this.log.error({ turnId: ctx.turnId, code: errorName(error) }, 'turn failed');
      if (!ctx.cancelled) this.reportError(ctx.turnId, 'INTERNAL', 'Something went wrong. Please try again.', true);
    }
  }

  /**
   * A bill with an open question: read the utterance as the answer first (shared `answerFollowUp`).
   * Rules only and synchronous, so it never waits on a model. Returns false when the utterance is
   * clearly another command, which then goes through the usual path.
   */
  private answerQuestion(ctx: TurnContext, transcript: string, catalog: Catalog, index: CatalogIndex): boolean {
    const context = this.correctionContext;
    if (!context?.clarification || context.intent !== 'create_bill') return false;
    const follow = answerFollowUp(context, transcript, index);
    if (follow.kind === 'command') return false;
    this.timer.mark(ctx.turnId, 'rules_done');
    this.timer.setParseSource(ctx.turnId, 'rules');

    let draft: DraftMessage;
    let cache: boolean;
    if (follow.kind === 'cancel') {
      draft = { type: 'draft', turnId: ctx.turnId, draftId: context.draftId, intent: 'cancel', source: 'rules', confidence: 0.95, unresolved: [], warnings: [], replyText: cancelled(ctx.turnId) };
      cache = true;
      this.correctionContext = null;
      this.pending = null;
    } else if (follow.kind === 'missed') {
      // The same question again (one more attempt), or the tap fallback. The draft is unchanged.
      const clarification = repeatClarification(context.clarification, follow.transcript);
      const line = clarification.itemIndex !== undefined ? context.bill?.items[clarification.itemIndex] : undefined;
      draft = { ...context, turnId: ctx.turnId, clarification, replyText: clarifyAsk(clarification, line?.name, ctx.turnId) };
      cache = clarification.fallback; // only the fallback sentence is a fixed phrase
      this.correctionContext = draft;
    } else {
      const outcome: ParseOutcome = { parsed: follow.parsed, resolution: resolveUtterance(follow.parsed, index), source: 'rules', needsReview: false, llm: 'skipped' };
      const result = buildDraft({
        turnId: ctx.turnId,
        outcome,
        catalog,
        pending: this.pending,
        draftId: context.draftId, // the same bill, updated: never a "replace this bill?" dialog
        transcript: follow.transcript,
        previous: context.clarification,
      });
      draft = result.draft;
      cache = result.cacheReply;
      this.correctionContext = draft.intent === 'create_bill' ? draft : null;
      this.pending = isConfirmable(draft) ? { draftId: draft.draftId, intent: 'create_bill', canConfirm: true } : null;
    }
    this.timer.mark(ctx.turnId, 'draft');
    this.out.json(draft);
    this.sendTiming(ctx.turnId);
    if (!this.tts.speak(ctx.turnId, draft.replyText, { cache })) this.reportError(ctx.turnId, 'TTS_UNAVAILABLE', 'Could not speak the reply.', true);
    return true;
  }

  private countLlm(status: string): void {
    if (status === 'skipped' || status === 'not_configured') return;
    this.metrics.llmCalls++;
    if (status !== 'ok') this.metrics.llmFallbacks++;
  }

  // ---- upstream events --------------------------------------------------------------------

  private attachStt(): void {
    const { stt } = this;
    stt.on('speechStart', (turnId) => {
      if (this.isCurrent(turnId)) this.out.json({ type: 'speech_start', turnId });
    });
    stt.on('processing', (turnId) => {
      if (!this.isCurrent(turnId)) return;
      this.timer.mark(turnId, 'processing');
      this.out.json({ type: 'processing', turnId });
    });
    stt.on('commitSent', (turnId) => {
      if (this.isCurrent(turnId)) this.timer.mark(turnId, 'commit_sent');
    });
    stt.on('transcript', (transcript) => this.onTranscript(transcript));
    stt.on('usage', (turnId, seconds) => {
      if (turnId === this.activeTurn) this.settleCapture(seconds);
    });
    stt.on('failure', ({ turnId, code, message, retryable }) => {
      this.metrics.sttErrors++;
      if (turnId !== undefined && !this.isCurrent(turnId)) return;
      this.reportError(turnId, code, message, retryable);
    });
  }

  private attachTts(): void {
    const { tts } = this;
    tts.on('request', (turnId) => this.timer.mark(turnId, 'tts_request'));
    tts.on('firstChunk', (turnId) => this.timer.mark(turnId, 'tts_first_chunk'));
    tts.on('start', (turnId, { sampleRate, cached }) => {
      this.out.json({
        type: 'tts_start',
        turnId,
        sampleRate,
        format: TTS_PCM_FORMAT,
        ...(cached ? { cached: true } : {}),
      });
    });
    tts.on('chunk', (turnId, frame) => {
      this.out.tts(frame, turnId);
    });
    tts.on('end', (turnId, interrupted) => {
      this.lastEnded = turnId;
      this.out.json({ type: 'tts_end', turnId, ...(interrupted ? { interrupted: true } : {}) });
      this.sendTiming(turnId);
    });
    tts.on('failure', ({ turnId, code, message, retryable }) => {
      this.metrics.ttsErrors++;
      this.reportError(turnId, code, message, retryable);
    });
    tts.on('budget', () => {
      this.out.json({
        type: 'limit',
        reason: 'budget',
        message: "Today's demo budget is used up.",
        resetAt: this.guard.resetAt(),
      });
    });
  }

  // ---- helpers ----------------------------------------------------------------------------

  private isCurrent(turnId: number): boolean {
    return this.current?.turnId === turnId && !this.current.cancelled;
  }

  private reportError(turnId: number | undefined, code: ErrorCode, message: string, retryable: boolean): void {
    this.out.json({
      type: 'error',
      code,
      message,
      retryable,
      ...(turnId !== undefined ? { turnId } : {}),
    });
  }

  private sendTiming(turnId: number): void {
    const timing = this.timer.message(turnId);
    if (timing) this.out.json(timing);
  }
}

const PENDING_INTENTS: ReadonlySet<string> = new Set<PendingDraft['intent']>(['create_bill', 'record_payment', 'out_of_stock', 'add_customer', 'add_product', 'add_products', 'update_price']);
const isPendingIntent = (intent: DraftMessage['intent']): intent is PendingDraft['intent'] => PENDING_INTENTS.has(intent);

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
