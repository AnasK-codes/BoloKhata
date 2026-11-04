import { describe, expect, it } from 'vitest';
import type { TurnRecord } from '../turn/types';
import { turnMetrics } from '../turn/timing';
import { hudExport, hudRows } from './hud';

const record: TurnRecord = {
  turnId: 5,
  pressAt: 100,
  browser: { press: 0, release: 1000, processing: 1040, transcript: 1500, draft: 1520, first_audible: 1900 },
  gateway: { commit_sent: 2, transcript: 450 },
  parseSource: 'rules',
};

describe('latency HUD data', () => {
  it('lists the four release spans and omits interrupt time when it was not measured', () => {
    const rows = hudRows(turnMetrics(record));
    expect(rows.map((r) => [r.key, r.ms])).toEqual([
      ['releaseToProcessing', 40],
      ['releaseToTranscript', 500],
      ['releaseToDraft', 520],
      ['releaseToFirstAudible', 900],
    ]);
  });

  it('adds interrupt-to-silence when it was measured', () => {
    expect(hudRows(turnMetrics({ ...record, pressToSilenceMs: 6 })).at(-1)).toEqual({ key: 'pressToSilence', label: 'Interrupt → silence', ms: 6 });
  });

  it('keeps unmeasured spans as undefined rather than inventing them', () => {
    const rows = hudRows(turnMetrics({ ...record, browser: { press: 0, release: 10 } }));
    expect(rows.every((r) => r.ms === undefined)).toBe(true);
  });

  it('exports valid JSON with only measured numbers and the raw spans', () => {
    const json = JSON.parse(hudExport([record], 12.34));
    expect(json.connectionRttMs).toBe(12.3);
    expect(json.turns[0]).toMatchObject({ turnId: 5, parseSource: 'rules', browserSpans: record.browser, gatewaySpans: record.gateway });
    expect(json.turns[0].metrics).toMatchObject({ releaseToTranscript: 500, gatewayStt: 448 });
    expect(json.turns[0].metrics.pressToSilence).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/transcript text/i);
  });

  it('exports an empty list without failing', () => {
    expect(JSON.parse(hudExport([], null))).toMatchObject({ connectionRttMs: null, turns: [] });
  });
});
