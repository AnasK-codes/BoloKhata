import {
  PROTOCOL_VERSION,
  decodeTtsFrame,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
} from '@bolbill/shared';
import { backoffDelay, type BackoffOptions } from './backoff';
import type { CatalogSnapshot, ConnectionState, RealtimeEvents, RealtimeIssue } from './types';

export interface RealtimeConfig {
  /** Gateway origin, for example `http://localhost:8080`. */
  gatewayUrl: string;
  /** Read at every (re)connect, so a reconnect sends current prices and balances. */
  getCatalog: () => CatalogSnapshot | Promise<CatalogSnapshot>;
  lang?: string;
  /** Demo access code, when the gateway requires one. */
  accessCode?: () => string | undefined;
  heartbeatMs?: number;
  /** How long to wait for `ready` after the socket opens. */
  helloTimeoutMs?: number;
  /** Audio is dropped (never queued) once this much is waiting in the socket: about 2 s of speech. */
  maxBufferedBytes?: number;
  backoff?: BackoffOptions;
}

/** Everything that touches the outside world, so tests can replace it. */
export interface RealtimeDeps {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  now: () => number;
  random: () => number;
}

export interface RealtimeStats {
  audioFramesSent: number;
  audioFramesDropped: number;
  badMessages: number;
  badBinary: number;
  reconnects: number;
}

const WS_OPEN = 1;
const DEFAULT_HEARTBEAT_MS = 10_000;
const DEFAULT_HELLO_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BUFFERED = 64 * 1024;
/** After returning to the foreground, how long a ping may go unanswered before we reconnect. */
const VERIFY_TIMEOUT_MS = 2500;
const MIN_LIMIT_RETRY_SEC = 2;
const BUDGET_RETRY_SEC = 120;
const CLOSE_SESSION_EXPIRED = 4001;
const CLOSE_BUDGET = 4002;

interface SessionResponse {
  token?: unknown;
}

function defaultDeps(): RealtimeDeps {
  return {
    fetch: (...args) => globalThis.fetch(...args),
    WebSocket: globalThis.WebSocket,
    now: () => performance.now(),
    random: Math.random,
  };
}

/**
 * The browser end of the gateway protocol: gets a session token, opens the WebSocket, sends
 * `hello`, then relays validated messages up and audio frames down the socket. It keeps the
 * connection alive (ping/pong, reconnect with backoff) and reports connection state; it knows
 * nothing about turns or the UI.
 */
export class RealtimeClient {
  private state: ConnectionState = { status: 'idle' };
  private readonly deps: RealtimeDeps;
  private ws: WebSocket | null = null;
  /** Bumped for every socket, so late events from an old socket are ignored. */
  private generation = 0;
  private attempt = 0;
  private wantConnected = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private helloTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private verifyTimer: ReturnType<typeof setTimeout> | undefined;
  private lastPongAt = 0;
  private rttMs: number | null = null;
  private dropping = false;
  readonly stats: RealtimeStats = {
    audioFramesSent: 0,
    audioFramesDropped: 0,
    badMessages: 0,
    badBinary: 0,
    reconnects: 0,
  };

  constructor(
    private readonly config: RealtimeConfig,
    private readonly events: RealtimeEvents = {},
    deps: Partial<RealtimeDeps> = {},
  ) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  getState(): ConnectionState {
    return this.state;
  }

  get isReady(): boolean {
    return this.state.status === 'ready' && this.ws?.readyState === WS_OPEN;
  }

  /** Starts connecting. Idempotent; call it when the page opens to pre-warm the session. */
  connect(): void {
    this.wantConnected = true;
    if (this.state.status === 'connecting' || this.state.status === 'ready') return;
    if (this.state.status === 'blocked') return;
    void this.open();
  }

  /** Stops for good (no reconnect). */
  close(): void {
    this.wantConnected = false;
    this.clearTimers();
    this.dropSocket(1000);
    this.setState({ status: 'closed' });
  }

  /** JSON message to the gateway. Returns false when it could not be sent. */
  send(message: ClientMessage): boolean {
    if (!this.isReady) return false;
    this.ws?.send(JSON.stringify(message));
    return true;
  }

  /**
   * One 1,024-byte microphone frame, straight to the socket (WebSocket.send copies it, so the
   * caller may reuse the buffer afterwards). Hot path: no allocation, no JSON. If the socket
   * is not ready or its send buffer is full the frame is dropped, never queued.
   */
  sendAudio(frame: ArrayBuffer): boolean {
    const ws = this.ws;
    if (!this.isReady || ws === null) return this.dropFrame('not_ready');
    if (ws.bufferedAmount > (this.config.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED)) {
      return this.dropFrame('backpressure');
    }
    ws.send(frame);
    this.stats.audioFramesSent++;
    this.dropping = false;
    return true;
  }

  /**
   * Pre-warm and recover: reconnect at once when the page comes back or the network returns,
   * instead of waiting out a backoff timer, and check that an apparently open socket is alive.
   */
  attachPageLifecycle(doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>, win: Pick<Window, 'addEventListener' | 'removeEventListener'>): () => void {
    const wake = () => {
      if (!this.wantConnected) return;
      if (this.state.status === 'ready') this.verify();
      else if (this.state.status !== 'connecting' && this.state.status !== 'blocked') this.reconnectNow();
    };
    const onVisibility = () => {
      if (doc.visibilityState === 'visible') wake();
    };
    doc.addEventListener('visibilitychange', onVisibility);
    win.addEventListener('online', wake);
    return () => {
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('online', wake);
    };
  }

  // ---- connecting -------------------------------------------------------------------------

  private async open(): Promise<void> {
    clearTimeout(this.retryTimer);
    const generation = ++this.generation;
    this.setState({ status: 'connecting', attempt: this.attempt });

    let token: string;
    try {
      const result = await this.fetchToken();
      if (generation !== this.generation) return;
      if (result.kind !== 'token') return this.handleSessionRefusal(result);
      token = result.token;
    } catch {
      if (generation === this.generation) this.scheduleReconnect();
      return;
    }

    const url = `${this.config.gatewayUrl.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
    const ws = new this.deps.WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => void this.onOpen(ws, generation);
    ws.onmessage = (event) => {
      if (generation === this.generation) this.onData(event.data);
    };
    ws.onclose = (event) => {
      if (generation === this.generation) this.onClosed(event.code);
    };
    ws.onerror = () => undefined; // `close` always follows and carries the handling
  }

  private async fetchToken(): Promise<
    | { kind: 'token'; token: string }
    | { kind: 'limit'; reason: 'busy' | 'budget' | 'rate_limited'; message: string; retryAfterSec: number; resetAt?: string }
    | { kind: 'blocked'; reason: 'access_code_required' | 'origin_not_allowed' }
    | { kind: 'failed' }
  > {
    const accessCode = this.config.accessCode?.();
    const response = await this.deps.fetch(`${this.config.gatewayUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(accessCode !== undefined ? { accessCode } : {}),
    });
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (response.ok) {
      const token = (body as SessionResponse | null)?.token;
      return typeof token === 'string' ? { kind: 'token', token } : { kind: 'failed' };
    }
    if (response.status === 403) {
      const reason = body?.['error'] === 'access_code_required' ? 'access_code_required' : 'origin_not_allowed';
      return { kind: 'blocked', reason };
    }
    if (response.status === 429 || response.status === 503) {
      const reason = body?.['reason'];
      const retryAfter = typeof body?.['retryAfterSec'] === 'number' ? body['retryAfterSec'] : Number(response.headers.get('retry-after'));
      return {
        kind: 'limit',
        reason: reason === 'budget' || reason === 'rate_limited' ? reason : 'busy',
        message: typeof body?.['message'] === 'string' ? body['message'] : 'The demo is busy right now.',
        retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : reason === 'budget' ? BUDGET_RETRY_SEC : 5,
        ...(typeof body?.['resetAt'] === 'string' ? { resetAt: body['resetAt'] } : {}),
      };
    }
    return { kind: 'failed' };
  }

  private handleSessionRefusal(
    result: Exclude<Awaited<ReturnType<RealtimeClient['fetchToken']>>, { kind: 'token' }>,
  ): void {
    if (result.kind === 'failed') return this.scheduleReconnect();
    if (result.kind === 'blocked') {
      const message =
        result.reason === 'access_code_required'
          ? 'Access code chahiye. A demo access code is required.'
          : 'This site is not allowed to use the gateway.';
      this.setState({ status: 'blocked', reason: result.reason, message });
      return;
    }
    this.enterLimited(result.reason, result.message, result.retryAfterSec, result.resetAt);
  }

  private async onOpen(ws: WebSocket, generation: number): Promise<void> {
    if (generation !== this.generation) return;
    try {
      const catalog = await this.config.getCatalog();
      if (generation !== this.generation || ws.readyState !== WS_OPEN) return;
      ws.send(
        JSON.stringify({
          type: 'hello',
          v: PROTOCOL_VERSION,
          clientTime: Date.now(),
          lang: this.config.lang ?? 'hi-IN',
          catalog,
        }),
      );
      this.helloTimer = setTimeout(() => {
        if (generation === this.generation) this.recycle();
      }, this.config.helloTimeoutMs ?? DEFAULT_HELLO_TIMEOUT_MS);
    } catch {
      if (generation === this.generation) this.recycle();
    }
  }

  // ---- receiving --------------------------------------------------------------------------

  private onData(data: unknown): void {
    if (typeof data === 'string') {
      this.onJson(data);
    } else if (data instanceof ArrayBuffer) {
      const frame = decodeTtsFrame(data);
      if (frame === null) {
        this.stats.badBinary++;
        this.events.onIssue?.({ kind: 'bad_binary' });
        return;
      }
      this.events.onTtsAudio?.(frame.turnId, frame.pcm);
    }
  }

  private onJson(raw: string): void {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      // A newer gateway may send types we do not know: ignore those quietly.
      if (parsed.reason === 'unknown_type') return;
      this.stats.badMessages++;
      this.events.onIssue?.({
        kind: 'bad_message',
        ...(parsed.messageType !== undefined ? { messageType: parsed.messageType } : {}),
      });
      return;
    }
    const message = parsed.value;
    if (message.type === 'pong') return this.onPong(message.t);
    if (message.type === 'ready') this.onReady(message);
    else if (message.type === 'limit') this.onLimitMessage(message);
    this.events.onMessage?.(message);
  }

  private onReady(message: Extract<ServerMessage, { type: 'ready' }>): void {
    clearTimeout(this.helloTimer);
    this.attempt = 0;
    this.lastPongAt = this.deps.now();
    this.rttMs = null;
    this.setState({
      status: 'ready',
      sessionId: message.sessionId,
      maxUtteranceSeconds: message.limits.maxUtteranceSeconds,
      maxSessionMinutes: message.limits.maxSessionMinutes,
      rttMs: null,
    });
    this.startHeartbeat();
  }

  private onLimitMessage(message: Extract<ServerMessage, { type: 'limit' }>): void {
    // The socket usually closes right after; remember why so the close does not trigger a hot retry.
    const retryAfter =
      message.retryAfterSec ?? (message.reason === 'budget' ? BUDGET_RETRY_SEC : MIN_LIMIT_RETRY_SEC);
    this.enterLimited(message.reason, message.message, retryAfter, message.resetAt);
  }

  private enterLimited(
    reason: Extract<ConnectionState, { status: 'limited' }>['reason'],
    message: string,
    retryAfterSec: number,
    resetAt?: string,
  ): void {
    const seconds = Math.max(MIN_LIMIT_RETRY_SEC, retryAfterSec);
    this.stopHeartbeat();
    this.setState({
      status: 'limited',
      reason,
      message,
      retryAt: Date.now() + seconds * 1000,
      ...(resetAt !== undefined ? { resetAt } : {}),
    });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.wantConnected) void this.open();
    }, seconds * 1000);
  }

  // ---- keeping alive ----------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.config.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.ping();
    this.heartbeatTimer = setInterval(() => {
      if (this.deps.now() - this.lastPongAt > interval * 2.5) {
        // Half-open connection (common on mobile networks): the browser may not notice for minutes.
        this.recycle();
        return;
      }
      this.ping();
    }, interval);
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.verifyTimer);
    this.heartbeatTimer = undefined;
  }

  private ping(): void {
    this.send({ type: 'ping', t: this.deps.now() });
  }

  private onPong(sentAt: number): void {
    const now = this.deps.now();
    this.lastPongAt = now;
    clearTimeout(this.verifyTimer);
    this.rttMs = Math.max(0, now - sentAt);
    if (this.state.status === 'ready') this.setState({ ...this.state, rttMs: this.rttMs });
  }

  private verify(): void {
    const before = this.lastPongAt;
    this.ping();
    clearTimeout(this.verifyTimer);
    this.verifyTimer = setTimeout(() => {
      if (this.lastPongAt === before && this.state.status === 'ready') this.recycle();
    }, VERIFY_TIMEOUT_MS);
  }

  // ---- closing and retrying ---------------------------------------------------------------

  private onClosed(code: number): void {
    this.clearTimers();
    this.ws = null;
    if (!this.wantConnected) return;
    if (this.state.status === 'limited') return; // the retry timer is already set
    if (code === CLOSE_BUDGET) {
      this.enterLimited('budget', "Today's demo budget is used up.", BUDGET_RETRY_SEC);
      return;
    }
    if (code === CLOSE_SESSION_EXPIRED) {
      // A long session ended normally: start a fresh one straight away.
      this.attempt = 0;
      void this.open();
      return;
    }
    this.scheduleReconnect();
  }

  /** Drop the current socket as if it had failed, and go through the normal retry path. */
  private recycle(): void {
    this.clearTimers();
    this.dropSocket(4000);
    if (this.wantConnected) this.scheduleReconnect();
  }

  private reconnectNow(): void {
    clearTimeout(this.retryTimer);
    this.attempt = 0;
    void this.open();
  }

  private scheduleReconnect(): void {
    this.stats.reconnects++;
    const delayMs = backoffDelay(this.attempt, this.deps.random, this.config.backoff);
    this.setState({ status: 'reconnecting', attempt: this.attempt, delayMs });
    this.attempt++;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.wantConnected) void this.open();
    }, delayMs);
  }

  private dropSocket(code: number): void {
    const ws = this.ws;
    this.ws = null;
    this.generation++; // late events from this socket are now ignored
    if (ws === null) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close(code);
    } catch {
      // already closing
    }
  }

  private clearTimers(): void {
    clearTimeout(this.helloTimer);
    this.stopHeartbeat();
  }

  private dropFrame(reason: 'not_ready' | 'backpressure'): false {
    this.stats.audioFramesDropped++;
    if (!this.dropping) {
      this.dropping = true;
      const issue: RealtimeIssue = { kind: 'audio_dropped', reason };
      this.events.onIssue?.(issue);
    }
    return false;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.events.onState?.(state);
  }
}
