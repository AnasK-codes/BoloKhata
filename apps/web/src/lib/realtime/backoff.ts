export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
}

/**
 * Delay before reconnect attempt number `attempt` (0 for the first retry): exponential growth
 * with a cap, and "equal jitter" (half fixed, half random) so many clients that lost the
 * server at the same moment do not all return at the same moment, yet nobody retries instantly.
 */
export function backoffDelay(attempt: number, random: () => number, options: BackoffOptions = {}): number {
  const { baseMs = 500, maxMs = 10_000 } = options;
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}
