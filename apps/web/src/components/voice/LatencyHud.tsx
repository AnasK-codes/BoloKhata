'use client';

import { useState } from 'react';
import type { ConnectionState } from '@/lib/realtime/types';
import { turnMetrics } from '@/lib/turn/timing';
import type { TurnRecord } from '@/lib/turn/types';
import { Icon } from '../Icon';
import { hudRows, hudExport } from '@/lib/voice/hud';

/**
 * Measured spans for the latest turns. It only shows what was recorded: a span that did not
 * happen (no voice reply, no interrupt) shows a dash, never an estimate.
 */
export function LatencyHud({ turns, connection }: { turns: readonly TurnRecord[]; connection: ConnectionState }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const rtt = connection.status === 'ready' ? connection.rttMs : null;
  const latest = turns.at(-1);
  const metrics = latest ? turnMetrics(latest) : null;
  const rows = metrics ? hudRows(metrics) : [];
  const max = Math.max(1, ...rows.map((r) => r.ms ?? 0));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hudExport(turns, rtt));
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <section aria-label="Latency" className="rounded-2xl border border-line bg-inset p-3 font-mono text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-sans text-base font-bold"><Icon name="bolt" size={18} /> Latency <span className="font-normal text-muted">(measured)</span></h2>
        <span className="num text-dim">RTT {rtt === null ? '–' : `${Math.round(rtt)} ms`}{metrics?.parseSource ? ` · ${metrics.parseSource}` : ''}</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 font-sans text-muted">Ek turn bolo, phir yahan timing dikhegi.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex justify-between"><span>{r.label}</span><span className="num font-bold text-warn">{r.ms === undefined ? '–' : `${Math.round(r.ms)} ms`}</span></div>
              <div className="h-1.5 rounded bg-raised"><div className="h-full origin-left rounded bg-lime-300" style={{ transform: `scaleX(${r.ms === undefined ? 0 : r.ms / max})`, width: '100%' }} /></div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={() => void copy()} className="mt-3 min-h-12 w-full rounded-xl bg-control font-sans font-semibold">
        {copied === 'ok' ? 'Copy ho gaya' : copied === 'fail' ? 'Copy nahi hua' : 'Copy timings as JSON'}
      </button>
    </section>
  );
}
