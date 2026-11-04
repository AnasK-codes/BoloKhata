import { monitorEventLoopDelay } from 'node:perf_hooks';

const RESOLUTION_MS = 10;

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
  /** Turns where the rules were not enough and a model was asked. */
  llmCalls = 0;
  /** Of those, how many fell back to the rules result (timeout, error, invalid output). */
  llmFallbacks = 0;

  private loop: ReturnType<typeof monitorEventLoopDelay> | null = null;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = performance.now();

  /**
   * Process health for the operator: memory, CPU since the previous snapshot, and event-loop
   * delay over the same window (the histogram is reset each time). Event-loop delay is what a
   * blocked hot path looks like from the outside.
   */
  runtime(): Record<string, unknown> {
    this.loop ??= monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    if (this.loopStartedAt === 0) {
      this.loop.enable();
      this.loopStartedAt = performance.now();
    }
    const now = performance.now();
    const cpu = process.cpuUsage(this.lastCpu);
    const elapsedMs = Math.max(1, now - this.lastCpuAt);
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = now;
    const memory = process.memoryUsage();
    // The histogram's timer fires every `resolution` ms, so an idle loop reads about that value:
    // report only the delay beyond it.
    const ms = (ns: number) => (Number.isFinite(ns) ? Math.max(0, Math.round(ns / 1e4) / 100 - RESOLUTION_MS) : 0);
    const lag = { p50: ms(this.loop.percentile(50)), p99: ms(this.loop.percentile(99)), max: ms(this.loop.max) };
    this.loop.reset();
    return {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(memory.rss / 1048576),
      heapUsedMb: Math.round(memory.heapUsed / 104857.6) / 10,
      cpuPercent: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10,
      eventLoopDelayMs: lag,
    };
  }

  private loopStartedAt = 0;

  snapshot(extra: Record<string, unknown>): Record<string, unknown> {
    const { loop: _loop, lastCpu: _cpu, lastCpuAt: _at, loopStartedAt: _started, ...counters } = this;
    return { ...counters, runtime: this.runtime(), ...extra };
  }
}
