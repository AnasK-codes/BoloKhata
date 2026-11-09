import { parseArgs } from 'node:util';

export const EXPERIMENT_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'P'] as const;
/** Experiments that run only when named with --only (P spends credits on a listening test). */
export const OPT_IN_EXPERIMENTS: readonly string[] = ['P'];
export type ExperimentId = (typeof EXPERIMENT_IDS)[number];

export interface SpikeArgs {
  dryRun: boolean;
  /** null means every experiment. F (credit accounting) always runs at the end of a real run. */
  only: ExperimentId[] | null;
  label: string;
  maxAudioSeconds: number;
  maxTtsChars: number;
  clipsDir: string | null;
  /** How many clips each non-baseline STT variant uses (the baseline uses all of them). */
  subset: number;
  /** How many phrases each non-baseline TTS variant uses. */
  ttsSubset: number;
  repeats: number;
  skipLongIdle: boolean;
  /** Experiment P only: just these corpus entries (by id), to re-check a few words cheaply. null means all. */
  entries: string[] | null;
}

function positiveNumber(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
  return value;
}

function parseOnly(values: string[]): ExperimentId[] {
  const picked = new Set<ExperimentId>();
  for (const part of values.flatMap((v) => v.split(','))) {
    const id = part.trim().toUpperCase();
    if (!(EXPERIMENT_IDS as readonly string[]).includes(id)) {
      throw new Error(`--only: unknown experiment "${part}" (use ${EXPERIMENT_IDS.join(', ')})`);
    }
    picked.add(id as ExperimentId);
  }
  return [...picked];
}

/** Parses CLI flags. Throws an Error with a readable message on bad input. */
export function parseSpikeArgs(argv: string[]): SpikeArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      'dry-run': { type: 'boolean', default: false },
      only: { type: 'string', multiple: true },
      label: { type: 'string', default: 'local' },
      'max-audio-seconds': { type: 'string', default: '150' },
      'max-tts-chars': { type: 'string', default: '1500' },
      'clips-dir': { type: 'string' },
      subset: { type: 'string', default: '3' },
      'tts-subset': { type: 'string', default: '2' },
      repeats: { type: 'string', default: '1' },
      'skip-long-idle': { type: 'boolean', default: false },
      entries: { type: 'string' },
    },
    strict: true,
  });

  const label = values.label ?? 'local';
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(label)) {
    throw new Error('--label may only contain letters, digits, dot, dash and underscore (max 40)');
  }

  return {
    dryRun: values['dry-run'] ?? false,
    only: values.only ? parseOnly(values.only) : null,
    label,
    maxAudioSeconds: positiveNumber('max-audio-seconds', values['max-audio-seconds'] ?? '150'),
    maxTtsChars: positiveNumber('max-tts-chars', values['max-tts-chars'] ?? '1500'),
    clipsDir: values['clips-dir'] ?? null,
    subset: Math.floor(positiveNumber('subset', values.subset ?? '3')),
    ttsSubset: Math.floor(positiveNumber('tts-subset', values['tts-subset'] ?? '2')),
    repeats: Math.floor(positiveNumber('repeats', values.repeats ?? '1')),
    skipLongIdle: values['skip-long-idle'] ?? false,
    entries: values.entries ? values.entries.split(',').map((e) => e.trim()).filter(Boolean) : null,
  };
}

export function selectedExperiments(args: SpikeArgs): ExperimentId[] {
  return args.only ?? EXPERIMENT_IDS.filter((id) => !OPT_IN_EXPERIMENTS.includes(id));
}
