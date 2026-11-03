import type { ExperimentId, SpikeArgs } from './args';
import type { Budget } from './budget';
import type { ClipSet } from './clips';
import type { SpikeEnv } from './env';
import type { Table } from './stats';

export interface ExperimentContext {
  args: SpikeArgs;
  env: SpikeEnv;
  /** Real key, or a placeholder when running against the mock servers. Never printed. */
  apiKey: string;
  budget: Budget;
  /** Null when no STT experiment is selected. */
  clips: ClipSet | null;
  /** Where audio and JSON for this run are written. */
  outDir: string;
  log: (line: string) => void;
}

export interface ExperimentResult {
  id: ExperimentId;
  title: string;
  tables: Table[];
  notes: string[];
  /** Raw numbers, written to the results JSON. */
  data: unknown;
  /** Human-confirmable suggestions derived from the numbers (written into docs/LATENCY.md). */
  suggestions: string[];
}

export const STT_EXPERIMENTS: readonly ExperimentId[] = ['B', 'C'];
