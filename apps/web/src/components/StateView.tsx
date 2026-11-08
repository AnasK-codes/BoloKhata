import type { ReactNode } from 'react';

/** One consistent look for loading, empty and error states, so no screen is ever blank. */
export function StateView({ kind, title, hint, children }: { kind: 'loading' | 'empty' | 'error'; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading'} className="pop rounded-2xl bg-card px-6 py-10 text-center shadow-[var(--shadow-card)]">
      {kind === 'loading' && <span aria-hidden="true" className="spin mx-auto mb-4 block h-7 w-7 rounded-full border-[3px] border-control border-t-brand" />}
      {kind === 'empty' && <span aria-hidden="true" className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-inset text-muted"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Zm3 4v2h8V7H8Zm0 4v2h8v-2H8Z" /></svg></span>}
      {kind === 'error' && <span aria-hidden="true" className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-bad/10 text-bad"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 20h20L12 3Zm1 13h-2v-2h2v2Zm0-4h-2V9h2v3Z" /></svg></span>}
      <p className="text-lg font-semibold tracking-tight">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-dim">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function OfflineBadge({ online }: { online: boolean }) {
  if (online) return null;
  return <p className="rounded-xl bg-raised px-3 py-2 text-sm text-ink" role="status">Offline: yeh screen bina internet ke chalti hai. Bolna band hai.</p>;
}
