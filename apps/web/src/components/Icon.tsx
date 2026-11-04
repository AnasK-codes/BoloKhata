const PATHS = {
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2Z',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4 0-7.5 2-7.5 5v2h15v-2c0-3-3.5-5-7.5-5Z',
  speaker: 'M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5Zm-2-7.7v2.1A6.5 6.5 0 0 1 14.5 17.6v2.1A8.5 8.5 0 0 0 14.5 4.3Z',
  alert: 'M12 3 2 20h20L12 3Zm1 13h-2v-2h2v2Zm0-4h-2V9h2v3Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  stop: 'M7 7h10v10H7z',
} as const;

export type IconName = keyof typeof PATHS;

/** Decorative by default (the label beside it carries the meaning); pass `label` when it stands alone. */
export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <path d={PATHS[name]} />
    </svg>
  );
}
