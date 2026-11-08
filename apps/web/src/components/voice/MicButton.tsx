'use client';

import { useEffect, useRef, type HTMLAttributes } from 'react';
import { Icon } from '../Icon';

interface Props {
  listening: boolean;
  busy: boolean;
  /** The voice is playing; pressing interrupts it. */
  speaking: boolean;
  disabled: boolean;
  label: string;
  /** Microphone RMS from the capture worklet, written by the session. */
  level: { current: number };
  buttonProps: HTMLAttributes<HTMLButtonElement>;
}

type MicVisual = 'idle' | 'listening' | 'busy' | 'speaking';

/** The level is quantised to 25 steps and each step's CSS value is built once, so the frame loop allocates nothing. */
const STEPS = 24;
const LEVEL_VALUES = Array.from({ length: STEPS + 1 }, (_, i) => (i / STEPS).toFixed(3));

/**
 * The hero control: a brushed-metal bezel around a glass cap. All four states (idle, listening,
 * thinking, speaking) are CSS on `data-state`, so React renders only when the phase changes.
 * While listening, one requestAnimationFrame loop writes the voice level into `--lvl` on this
 * element, and three rings scale from it with transforms only. With reduced motion the loop
 * does not run and the rings sit still.
 */
export function MicButton({ listening, busy, speaking, disabled, label, level, buttonProps }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const state: MicVisual = listening ? 'listening' : busy ? 'busy' : speaking ? 'speaking' : 'idle';

  useEffect(() => {
    const el = root.current;
    if (!listening || el === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let smooth = 0;
    let shown = -1;
    let frame = 0;
    const tick = () => {
      // sqrt lifts quiet speech; attack fast, release slow so it feels alive but not jittery.
      const target = Math.min(1, Math.sqrt(level.current) * 2.4);
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
      const step = Math.round(smooth * STEPS);
      if (step !== shown) {
        shown = step;
        el.style.setProperty('--lvl', LEVEL_VALUES[step] ?? '0');
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.style.removeProperty('--lvl');
    };
  }, [listening, level]);

  return (
    <div ref={root} className="mic" data-state={disabled ? 'idle' : state}>
      <span className="mic-halo" aria-hidden="true" />
      <span className="mic-ring r1" aria-hidden="true" />
      <span className="mic-ring r2" aria-hidden="true" />
      <span className="mic-ring r3" aria-hidden="true" />
      <button
        type="button"
        disabled={disabled}
        {...buttonProps}
        aria-label={label}
        aria-pressed={listening}
        className="mic-btn"
      >
        <span className="mic-cap" aria-hidden="true" />
        <span className="mic-core" aria-hidden="true" />
        <span className="mic-press" aria-hidden="true" />
        <span className="mic-shine" aria-hidden="true" />
        <span className="mic-shimmer" aria-hidden="true" />
        <Icon name={speaking && !listening ? 'speaker' : 'mic'} size={40} />
      </button>
      {listening && (
        <span className="mic-badge">
          <i aria-hidden="true" />
          REC
        </span>
      )}
    </div>
  );
}
