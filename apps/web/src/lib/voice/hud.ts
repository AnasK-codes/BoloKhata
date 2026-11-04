import type { TurnMetrics } from '../turn/timing';
import { turnMetrics } from '../turn/timing';
import type { TurnRecord } from '../turn/types';

export interface HudRow {
  key: string;
  label: string;
  ms: number | undefined;
}

/** The rows of the timeline, in the order a turn happens. Interrupt time is shown only when it was measured. */
export function hudRows(m: TurnMetrics): HudRow[] {
  const rows: HudRow[] = [
    { key: 'releaseToProcessing', label: 'Release → processing', ms: m.releaseToProcessing },
    { key: 'releaseToTranscript', label: 'Release → transcript', ms: m.releaseToTranscript },
    { key: 'releaseToDraft', label: 'Release → bill', ms: m.releaseToDraft },
    { key: 'releaseToFirstAudible', label: 'Release → first sound', ms: m.releaseToFirstAudible },
  ];
  if (m.pressToSilence !== undefined) rows.push({ key: 'pressToSilence', label: 'Interrupt → silence', ms: m.pressToSilence });
  return rows;
}

/** Everything measured, for pasting into docs/LATENCY.md. Spans that were not measured are left out. */
export function hudExport(turns: readonly TurnRecord[], rttMs: number | null): string {
  const round = (n: number) => Math.round(n * 10) / 10;
  return JSON.stringify(
    {
      note: 'Measured in the browser with performance.now(); gateway spans are on the gateway clock. Conditions: fill in device, network and gateway region.',
      connectionRttMs: rttMs === null ? null : round(rttMs),
      turns: turns.map((record) => ({
        turnId: record.turnId,
        parseSource: record.parseSource ?? null,
        metrics: Object.fromEntries(Object.entries(turnMetrics(record)).filter(([k, v]) => k !== 'turnId' && k !== 'parseSource' && typeof v === 'number').map(([k, v]) => [k, round(v as number)])),
        browserSpans: record.browser,
        gatewaySpans: record.gateway,
      })),
    },
    null,
    2,
  );
}
