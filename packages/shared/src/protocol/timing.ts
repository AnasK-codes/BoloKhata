/**
 * Span names shared by the gateway and the latency HUD so both agree on vocabulary.
 * A span value is a timestamp in milliseconds relative to the start of the turn on the
 * side that recorded it (browser spans relative to `press`, gateway spans relative to
 * `ptt_start` arrival). The HUD merges them into one record per turn.
 */
export const TIMING_SPANS = [
  'press',
  'first_frame_sent',
  'release',
  'commit_sent',
  'processing',
  'transcript',
  'rules_done',
  'llm_done',
  'draft',
  'tts_request',
  'tts_first_chunk',
  'tts_start_received',
  'first_audible',
] as const;

export type TimingSpan = (typeof TIMING_SPANS)[number];
