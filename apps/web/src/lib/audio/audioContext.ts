let shared: AudioContext | null = null;

/**
 * One AudioContext for the whole app, at the device's native rate. We deliberately do not pass
 * `sampleRate`: forcing 16 kHz makes some browsers resample badly or refuse, and the capture
 * worklet does its own anti-aliased decimation. Playback uses the same context so both
 * directions share one clock.
 */
export function getAudioContext(): AudioContext {
  if (shared === null || shared.state === 'closed') {
    shared = new AudioContext({ latencyHint: 'interactive' });
  }
  return shared;
}

/**
 * Must be called from a user gesture (iOS Safari keeps the context suspended otherwise).
 * Safe to call on every press: it is a no-op once the context is running.
 */
export async function unlockAudio(): Promise<AudioContext> {
  const context = getAudioContext();
  if (context.state !== 'running') await context.resume();
  return context;
}
