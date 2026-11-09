const PATHS = {
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2Z',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4 0-7.5 2-7.5 5v2h15v-2c0-3-3.5-5-7.5-5Z',
  speaker: 'M4 9v6h4l5 4V5L8 9H4Zm12.5 3a4 4 0 0 0-2-3.5v7a4 4 0 0 0 2-3.5Zm-2-7.7v2.1A6.5 6.5 0 0 1 14.5 17.6v2.1A8.5 8.5 0 0 0 14.5 4.3Z',
  alert: 'M12 3 2 20h20L12 3Zm1 13h-2v-2h2v2Zm0-4h-2V9h2v3Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  stop: 'M7 7h10v10H7z',
  book: 'M5 3h11a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Z',
  receipt: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Z',
  box: 'M3 7l9-4 9 4v10l-9 4-9-4V7Zm9-1.8L6.2 7.7 12 10.3l5.8-2.6L12 5.2Z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 5v-2l-2.1-.6a7 7 0 0 0-.7-1.7l1.1-1.9-1.4-1.4-1.9 1.1a7 7 0 0 0-1.7-.7L13.7 3h-2l-.6 2.1a7 7 0 0 0-1.7.7L7.5 4.7 6.1 6.1l1.1 1.9a7 7 0 0 0-.7 1.7L4.4 10.3v2l2.1.6c.2.6.4 1.2.7 1.7l-1.1 1.9 1.4 1.4 1.9-1.1c.5.3 1.1.5 1.7.7l.6 2.1h2l.6-2.1c.6-.2 1.2-.4 1.7-.7l1.9 1.1 1.4-1.4-1.1-1.9c.3-.5.5-1.1.7-1.7l2.1-.6Z',
  arrow: 'M8 6v2h7.6L5 18.6 6.4 20 17 9.4V17h2V6H8Z',
  chevron: 'M9.3 5.3 7.9 6.7 13.2 12l-5.3 5.3 1.4 1.4L16 12 9.3 5.3Z',
  pencil: 'M3 17.3V21h3.7L17.8 9.9l-3.7-3.7L3 17.3ZM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.7L20.7 7Z',
  trash: 'M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.9a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8ZM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4ZM4.3 14a8.2 8.2 0 0 1 0-4h3.4a16.5 16.5 0 0 0 0 4H4.3Zm.8 2h2.9c.3 1.3.8 2.5 1.4 3.6A8 8 0 0 1 5.1 16ZM8 8H5.1a8 8 0 0 1 4.3-3.6C8.8 5.5 8.3 6.7 8 8Zm4 12c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4Zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4Zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h2.9a8 8 0 0 1-4.3 3.6Zm1.7-5.6a16.5 16.5 0 0 0 0-4h3.4a8.2 8.2 0 0 1 0 4h-3.4Z',
  chat: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 5v2h10V9H7Zm0 4v2h7v-2H7Z',
  close: 'M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9 4.9-4.9Z',
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
