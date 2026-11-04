import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { HoldOrLatch, bindPageGuards, type HoldOrLatchCallbacks } from './holdOrLatch';

/** Stops the browser from treating a press on the mic as scroll, text selection or a long-press menu. */
const BUTTON_STYLE: CSSProperties = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
};

export function useHoldOrLatch(callbacks: HoldOrLatchCallbacks) {
  // The latest callbacks are always used without rebuilding the gesture (which would lose its state).
  const latest = useRef(callbacks);
  latest.current = callbacks;

  const gesture = useMemo(
    () =>
      new HoldOrLatch({
        onStart: () => latest.current.onStart(),
        onLatch: () => latest.current.onLatch(),
        onStop: (reason) => latest.current.onStop(reason),
      }),
    [],
  );

  useEffect(() => {
    const dispose = bindPageGuards(gesture, document, window);
    return () => {
      dispose();
      gesture.abort(); // unmounting mid-press must not leave a turn running
    };
  }, [gesture]);

  return {
    gesture,
    buttonProps: {
      style: BUTTON_STYLE,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        // Capture keeps `pointerup` coming to the button even if the finger slides off it.
        event.currentTarget.setPointerCapture(event.pointerId);
        gesture.pointerDown(event.pointerId);
      },
      onPointerUp: (event: PointerEvent<HTMLElement>) => gesture.pointerUp(event.pointerId),
      onPointerCancel: (event: PointerEvent<HTMLElement>) => gesture.pointerCancel(event.pointerId),
      onLostPointerCapture: (event: PointerEvent<HTMLElement>) => gesture.pointerCancel(event.pointerId),
      onContextMenu: (event: { preventDefault(): void }) => event.preventDefault(),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        gesture.keyDown(event.repeat);
      },
      onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        gesture.keyUp();
      },
    },
  };
}
