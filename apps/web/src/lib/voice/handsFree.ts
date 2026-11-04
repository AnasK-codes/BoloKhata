import type { TurnController } from '../turn/controller';

const LISTEN_MS = 4000;

/**
 * Optional hands-free confirm: when the spoken readback of a bill ends and the bill is still
 * waiting, listen for a few seconds for "haan" / "nahi" without a tap, then send what was said.
 * A silent window ends with a quiet "nothing heard" that is dismissed rather than shown as an error.
 * Returns a disposer. Does nothing unless `enabled()` is true at that moment.
 */
export function attachHandsFree(controller: TurnController, enabled: () => boolean): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let windowTurn: number | null = null;
  let previous = controller.state.phase;

  const unsubscribe = controller.store.subscribe((state) => {
    const was = previous;
    previous = state.phase;

    if (windowTurn !== null && state.phase === 'error' && state.error?.code === 'NO_TRANSCRIPT') {
      windowTurn = null;
      controller.dismissError();
      return;
    }
    if (was === 'speaking' && state.phase === 'reviewing' && state.pending && enabled() && state.connected) {
      controller.press();
      if (controller.state.phase !== 'listening') return;
      windowTurn = controller.state.turnId;
      timer = setTimeout(() => {
        if (controller.state.phase === 'listening' && controller.state.turnId === windowTurn) controller.release();
      }, LISTEN_MS);
    }
  });

  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
