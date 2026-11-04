/** A press longer than this is "hold to talk"; a shorter one is a tap that latches. */
export const HOLD_THRESHOLD_MS = 400;

/**
 * Why the turn stopped:
 *   release  the finger lifted after a hold: process what was said
 *   tap      the second tap of tap-to-latch: process what was said
 *   abort    the gesture was interrupted (pointer cancelled, window lost focus, page hidden):
 *            throw the turn away rather than send half an utterance
 */
export type StopReason = 'release' | 'tap' | 'abort';

export interface HoldOrLatchCallbacks {
  onStart(): void;
  onLatch(): void;
  onStop(reason: StopReason): void;
}

type GestureState =
  | 'idle'
  /** A pointer is down and the turn has started. */
  | 'held'
  /** Tapped and let go: still listening until the next tap. */
  | 'latched'
  /** The stopping tap is still down; its release must not start anything. */
  | 'stopping';

const KEYBOARD_POINTER = -1;

/**
 * The mic button's press logic, with no DOM in it so it can be tested with a fake clock.
 * `onStart` and `onStop` always come in pairs: whatever happens, a started turn ends in
 * exactly one `onStop`, and once it has, nothing is left running.
 */
export class HoldOrLatch {
  private state: GestureState = 'idle';
  private pointerId: number | null = null;
  private downAt = 0;

  constructor(
    private readonly callbacks: HoldOrLatchCallbacks,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** True from the first press until the turn has been stopped. */
  get active(): boolean {
    return this.state === 'held' || this.state === 'latched';
  }

  get latched(): boolean {
    return this.state === 'latched';
  }

  pointerDown(pointerId: number): void {
    if (this.state === 'idle') {
      this.state = 'held';
      this.pointerId = pointerId;
      this.downAt = this.now();
      this.callbacks.onStart();
    } else if (this.state === 'latched') {
      this.state = 'stopping';
      this.pointerId = pointerId;
      this.callbacks.onStop('tap');
    }
    // A second finger while one is already down is ignored.
  }

  pointerUp(pointerId: number): void {
    if (pointerId !== this.pointerId) return;
    if (this.state === 'stopping') {
      this.finish();
    } else if (this.state === 'held') {
      if (this.now() - this.downAt >= HOLD_THRESHOLD_MS) {
        this.finish();
        this.callbacks.onStop('release');
      } else {
        this.state = 'latched';
        this.pointerId = null;
        this.callbacks.onLatch();
      }
    }
  }

  pointerCancel(pointerId: number): void {
    if (pointerId !== this.pointerId) return;
    this.abort();
  }

  /** Space or Enter: the same gesture for keyboard users. Auto-repeat is ignored. */
  keyDown(repeat: boolean): void {
    if (!repeat) this.pointerDown(KEYBOARD_POINTER);
  }

  keyUp(): void {
    this.pointerUp(KEYBOARD_POINTER);
  }

  /** Stop at once from any state (blur, hidden page, unmount). Safe to call repeatedly. */
  abort(): void {
    const wasActive = this.active;
    this.finish();
    if (wasActive) this.callbacks.onStop('abort');
  }

  private finish(): void {
    this.state = 'idle';
    this.pointerId = null;
  }
}

/**
 * Things that must end a recording no matter what the finger is doing: the window losing
 * focus, the page being hidden or going into the back/forward cache. Returns a disposer.
 */
export function bindPageGuards(
  gesture: Pick<HoldOrLatch, 'abort'>,
  doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'>,
): () => void {
  const abort = () => gesture.abort();
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') gesture.abort();
  };
  win.addEventListener('blur', abort);
  win.addEventListener('pagehide', abort);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('blur', abort);
    win.removeEventListener('pagehide', abort);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
