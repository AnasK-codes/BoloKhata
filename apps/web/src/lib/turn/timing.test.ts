import { describe, expect, it } from 'vitest';
import { turnMetrics } from './timing';
import type { TurnRecord } from './types';

const record = (overrides: Partial<TurnRecord> = {}): TurnRecord => ({
  turnId: 3,
  pressAt: 0,
  browser: { press: 0, first_frame_sent: 12, release: 1800, processing: 1850, transcript: 2300, draft: 2320, first_audible: 2900 },
  gateway: { commit_sent: 1810, transcript: 2260, draft: 2268, tts_request: 2270, tts_first_chunk: 2540 },
  parseSource: 'rules',
  ...overrides,
});

describe('turnMetrics', () => {
  it('derives the HUD numbers from browser spans', () => {
    expect(turnMetrics(record())).toMatchObject({
      turnId: 3,
      pressToFirstFrame: 12,
      releaseToProcessing: 50,
      releaseToTranscript: 500,
      releaseToDraft: 520,
      releaseToFirstAudible: 1100,
    });
  });

  it('measures gateway work only on the gateway clock', () => {
    expect(turnMetrics(record())).toMatchObject({
      gatewayStt: 450,
      gatewayParse: 8,
      gatewayTtsFirstByte: 270,
      parseSource: 'rules',
    });
  });

  it('leaves out anything that was not measured instead of guessing', () => {
    const metrics = turnMetrics(record({ browser: { press: 0, release: 900 }, gateway: {} }));
    expect(Object.keys(metrics).sort()).toEqual(['parseSource', 'turnId']);
  });

  it('never reports a negative span', () => {
    const metrics = turnMetrics(record({ browser: { release: 500, processing: 400 } }));
    expect(metrics.releaseToProcessing).toBe(0);
  });
});
