import type { TurnRecord } from './types';

/** The numbers the latency HUD shows for one turn. Each is undefined until both ends are known. */
export interface TurnMetrics {
  turnId: number;
  /** Press to the first audio frame leaving the browser. */
  pressToFirstFrame?: number;
  releaseToProcessing?: number;
  releaseToTranscript?: number;
  releaseToDraft?: number;
  releaseToFirstAudible?: number;
  /** Press until the speaker was silent, when the press interrupted a spoken reply. */
  pressToSilence?: number;
  /** Time the gateway spent waiting for Gnani after `commit`. */
  gatewayStt?: number;
  /** Rules (and LLM, if used) from transcript to draft, on the gateway. */
  gatewayParse?: number;
  /** TTS request to its first audio chunk, on the gateway. */
  gatewayTtsFirstByte?: number;
  parseSource?: 'rules' | 'llm';
}

function between(from: number | undefined, to: number | undefined): number | undefined {
  return from !== undefined && to !== undefined ? Math.max(0, to - from) : undefined;
}

/**
 * Merges the browser's clock with the gateway's. The two clocks are never compared directly
 * (they are different machines): browser spans are differences on the browser clock, gateway
 * spans are differences on the gateway clock.
 */
export function turnMetrics(record: TurnRecord): TurnMetrics {
  const b = record.browser;
  const g = record.gateway;
  const metrics: TurnMetrics = { turnId: record.turnId };
  const set = <K extends keyof TurnMetrics>(key: K, value: TurnMetrics[K]) => {
    if (value !== undefined) metrics[key] = value;
  };
  set('pressToFirstFrame', between(b.press, b.first_frame_sent));
  set('releaseToProcessing', between(b.release, b.processing));
  set('releaseToTranscript', between(b.release, b.transcript));
  set('releaseToDraft', between(b.release, b.draft));
  set('releaseToFirstAudible', between(b.release, b.first_audible));
  set('pressToSilence', record.pressToSilenceMs);
  set('gatewayStt', between(g.commit_sent, g.transcript));
  set('gatewayParse', between(g.transcript, g.draft));
  set('gatewayTtsFirstByte', between(g.tts_request, g.tts_first_chunk));
  set('parseSource', record.parseSource);
  return metrics;
}
