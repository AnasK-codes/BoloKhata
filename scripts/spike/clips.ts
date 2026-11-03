import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT_DIR, SPIKE_DIR } from './env';
import { clipSeconds, readClipPcm } from './wav';

const clipsFileSchema = z.object({
  /** Extra key terms for the keyterms experiment; otherwise names from the seed catalog or a default. */
  keyterms: z.array(z.string().min(1)).max(200).optional(),
  clips: z
    .array(
      z.object({
        file: z.string().min(1),
        text: z.string().min(1),
        noisy: z.boolean().default(false),
      }),
    )
    .min(1),
});

export interface Clip {
  id: string;
  text: string;
  noisy: boolean;
  pcm: Buffer;
  seconds: number;
}

export interface ClipSet {
  dir: string;
  clips: Clip[];
  keyterms: string[];
}

// Fictional fallback so the keyterms experiment still runs without a catalog.
const DEFAULT_KEYTERMS = ['udhaar', 'aadha', 'dedh', 'dhai', 'Sharma', 'Verma', 'Maggi', 'aata', 'chawal', 'cheeni'];

export class ClipsMissingError extends Error {}

/** Collects name-like strings from data/seed-catalog.json when that file exists. */
function catalogKeyterms(): string[] | null {
  const file = path.join(ROOT_DIR, 'data', 'seed-catalog.json');
  if (!existsSync(file)) return null;
  const found = new Set<string>();
  const visit = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (['name', 'names', 'alias', 'aliases', 'hindi', 'hinglish'].includes(key) && value.length <= 40) {
        found.add(value);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, k);
    }
  };
  try {
    visit(JSON.parse(readFileSync(file, 'utf8')) as unknown, '');
  } catch {
    return null;
  }
  return found.size > 0 ? [...found].slice(0, 200) : null;
}

/** Loads the phone clips. Throws ClipsMissingError with a fix-it message when anything is absent. */
export function loadClips(dirOverride: string | null): ClipSet {
  const dir = dirOverride ? path.resolve(dirOverride) : path.join(SPIKE_DIR, 'clips');
  const manifest = path.join(dir, 'clips.json');
  if (!existsSync(manifest)) {
    throw new ClipsMissingError(
      `No clips.json in ${dir}. Record the clips described in scripts/spike/clips/README.md first.`,
    );
  }
  const parsed = clipsFileSchema.safeParse(JSON.parse(readFileSync(manifest, 'utf8')) as unknown);
  if (!parsed.success) {
    throw new ClipsMissingError(`clips.json is invalid: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  const missing = parsed.data.clips.filter((c) => !existsSync(path.join(dir, c.file))).map((c) => c.file);
  if (missing.length > 0) throw new ClipsMissingError(`Missing clip files in ${dir}: ${missing.join(', ')}`);

  const clips = parsed.data.clips.map((c): Clip => {
    const pcm = readClipPcm(path.join(dir, c.file));
    return { id: c.file.replace(/\.wav$/i, ''), text: c.text, noisy: c.noisy, pcm, seconds: clipSeconds(pcm) };
  });
  return { dir, clips, keyterms: parsed.data.keyterms ?? catalogKeyterms() ?? DEFAULT_KEYTERMS };
}

/** Picks `count` clips for a variant, preferring a mix of quiet and noisy ones, in file order. */
export function pickSubset(clips: Clip[], count: number): Clip[] {
  if (count >= clips.length) return clips;
  const noisy = clips.filter((c) => c.noisy);
  const quiet = clips.filter((c) => !c.noisy);
  const picked = new Set<Clip>();
  const alternate = [quiet, noisy];
  for (let i = 0; picked.size < count && i < clips.length; i++) {
    const source = alternate[i % 2] ?? [];
    const next = source.find((c) => !picked.has(c)) ?? clips.find((c) => !picked.has(c));
    if (next) picked.add(next);
  }
  return clips.filter((c) => picked.has(c));
}
