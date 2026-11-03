import type { LlmResult, StructuredRequest } from './types';

/**
 * Runs one model call under a hard deadline. `run` gets a signal that fires on timeout or when
 * the caller aborts; whatever it throws or returns is turned into a typed LlmResult, so no
 * adapter can throw into the turn pipeline or outlive its timebox.
 */
export async function runTimeboxed<T>(
  request: Pick<StructuredRequest<T>, 'timeoutMs' | 'signal'>,
  run: (signal: AbortSignal) => Promise<unknown>,
  parse: (raw: unknown) => T | null,
): Promise<LlmResult<T>> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const timeout = AbortSignal.timeout(request.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  try {
    const raw = await Promise.race([run(signal), whenAborted(signal)]);
    const value = parse(raw);
    return value === null
      ? { ok: false, reason: 'invalid_output', ms: elapsed() }
      : { ok: true, value, ms: elapsed() };
  } catch (error) {
    if (timeout.aborted) return { ok: false, reason: 'timeout', ms: elapsed() };
    if (request.signal?.aborted) return { ok: false, reason: 'aborted', ms: elapsed() };
    return { ok: false, reason: 'unavailable', ms: elapsed(), detail: errorName(error) };
  }
}

/** Rejects when the signal fires, so a client that ignores abort still cannot hold the turn. */
function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(new Error('aborted'));
    else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

/** Error class name only: messages can echo request content, which must never reach logs. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
