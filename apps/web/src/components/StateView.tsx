import type { ReactNode } from 'react';

/** One consistent look for loading, empty and error states, so no screen is ever blank. */
export function StateView({ kind, title, hint, children }: { kind: 'loading' | 'empty' | 'error'; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} aria-busy={kind === 'loading'} className={`rounded-2xl border border-dashed px-5 py-8 text-center ${kind === 'error' ? 'border-bad/70' : 'border-line'}`}>
      <p className="text-lg font-bold">{kind === 'loading' ? '…' : ''}{title}</p>
      {hint && <p className="mt-1 text-dim">{hint}</p>}
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function OfflineBadge({ online }: { online: boolean }) {
  if (online) return null;
  return <p className="rounded-xl bg-raised px-3 py-2 text-sm text-ink" role="status">Offline: yeh screen bina internet ke chalti hai. Bolna band hai.</p>;
}
