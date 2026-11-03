/** Plain counters for GET /metrics. No labels, no per-user data. */
export class Metrics {
  sessionsTotal = 0;
  sessionsRejected = 0;
  turnsTotal = 0;
  badMessages = 0;
  badAudioFrames = 0;
  droppedTtsFrames = 0;
  sttErrors = 0;
  ttsErrors = 0;

  snapshot(extra: Record<string, unknown>): Record<string, unknown> {
    return { ...this, ...extra };
  }
}
