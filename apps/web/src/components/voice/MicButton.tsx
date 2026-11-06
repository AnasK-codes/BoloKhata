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

/**
 * The hero control (112 px). While listening, a ring behind it breathes with the voice: one
 * transform updated from requestAnimationFrame, nothing that triggers layout. With reduced
 * motion the ring stays still and only the red recording state shows.
 */
export function MicButton({ listening, busy, speaking, disabled, label, level, buttonProps }: Props) {
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ring.current;
    if (!listening || el === null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let smooth = 0;
    let frame = 0;
    const tick = () => {
      // sqrt lifts quiet speech; attack fast, release slow so it feels alive but not jittery.
      const target = Math.min(1, Math.sqrt(level.current) * 2.4);
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
      el.style.transform = `scale(${(1 + smooth * 0.55).toFixed(3)})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      el.style.transform = '';
    };
  }, [listening, level]);

  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <div
        ref={ring}
        aria-hidden="true"
        className={`absolute h-28 w-28 rounded-full will-change-transform transition-colors ${listening ? 'bg-bad/35' : 'bg-control'}`}
      />
      <button
        type="button"
        disabled={disabled}
        {...buttonProps}
        aria-label={label}
        aria-pressed={listening}
        className={`relative flex h-28 w-28 items-center justify-center rounded-full shadow-[0_8px_30px_rgba(24,24,27,0.16)] outline-offset-4 transition-colors disabled:opacity-40 ${
          listening ? 'bg-bad text-on-solid' : busy ? 'bg-control text-ink' : speaking ? 'bg-card text-accent ring-4 ring-line' : 'bg-accent text-on-solid'
        }`}
      >
        <Icon name={speaking ? 'speaker' : 'mic'} size={46} />
      </button>
      {busy && (
        <span aria-hidden="true" className="spin absolute h-32 w-32 rounded-full border-4 border-transparent border-t-ink" />
      )}
      {listening && (
        <span className="absolute -bottom-1 flex items-center whitespace-nowrap gap-1.5 rounded-full bg-bad px-3 py-1 text-sm font-bold text-on-solid">
          <span className="rec-dot h-2.5 w-2.5 rounded-full bg-on-solid" aria-hidden="true" />
          REC
        </span>
      )}
    </div>
  );
}
