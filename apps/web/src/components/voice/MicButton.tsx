'use client';

import { useEffect, useRef, type HTMLAttributes } from 'react';

interface Props {
  listening: boolean;
  busy: boolean;
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
export function MicButton({ listening, busy, disabled, label, level, buttonProps }: Props) {
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
        className={`absolute h-28 w-28 rounded-full will-change-transform transition-colors ${listening ? 'bg-red-500/35' : 'bg-amber-400/10'}`}
      />
      <button
        type="button"
        disabled={disabled}
        {...buttonProps}
        aria-label={label}
        aria-pressed={listening}
        className={`relative flex h-28 w-28 items-center justify-center rounded-full shadow-[0_8px_30px_rgba(0,0,0,0.5)] outline-offset-4 transition-colors disabled:opacity-40 ${
          listening ? 'bg-red-500 text-white' : busy ? 'bg-stone-600 text-stone-200' : 'bg-amber-400 text-stone-950'
        }`}
      >
        <svg width="46" height="46" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2Z" />
        </svg>
      </button>
      {listening && (
        <span className="absolute -bottom-1 flex items-center whitespace-nowrap gap-1.5 rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">
          <span className="rec-dot h-2.5 w-2.5 rounded-full bg-white" aria-hidden="true" />
          REC
        </span>
      )}
    </div>
  );
}
