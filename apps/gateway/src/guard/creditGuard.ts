import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Credit guard: daily caps on Gnani usage so a public link cannot exhaust our credits.
 * Counters live behind `CreditStore`: memory in tests, a small file in deployment.
 * A cap of 0 means "none allowed", not "unlimited".
 */
export type CreditKind = 'stt_seconds' | 'tts_chars';

export interface CreditStore {
  get(day: string, kind: CreditKind): number;
  add(day: string, kind: CreditKind, amount: number): void;
}

export class MemoryCreditStore implements CreditStore {
  private readonly values = new Map<string, number>();

  get(day: string, kind: CreditKind): number {
    return this.values.get(`${day}:${kind}`) ?? 0;
  }

  add(day: string, kind: CreditKind, amount: number): void {
    const key = `${day}:${kind}`;
    this.values.set(key, Math.max(0, (this.values.get(key) ?? 0) + amount));
  }
}

const countersSchema = z.record(z.string().max(64), z.number().finite().min(0));

/**
 * Today's counters in a small JSON file, so a restart or redeploy does not reset the daily caps.
 * Writes are async (tmp file + rename), coalesced, and happen per turn, never per audio frame.
 * shortcut: a crash can lose the last write and a damaged file starts from zero; one process only.
 */
export class FileCreditStore implements CreditStore {
  private values: Record<string, number>;
  private writing: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    let raw: unknown = {};
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // Missing or unreadable: start from zero.
    }
    const parsed = countersSchema.safeParse(raw);
    this.values = parsed.success ? parsed.data : {};
  }

  get(day: string, kind: CreditKind): number {
    return this.values[`${day}:${kind}`] ?? 0;
  }

  add(day: string, kind: CreditKind, amount: number): void {
    const key = `${day}:${kind}`;
    const next = Math.max(0, (this.values[key] ?? 0) + amount);
    const today: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.values)) if (k.startsWith(`${day}:`)) today[k] = v;
    today[key] = next;
    this.values = today;
    this.dirty = true;
    this.writing ??= this.writeLoop();
  }

  /** Resolves once everything added so far is on disk. */
  async flush(): Promise<void> {
    await this.writing;
  }

  private async writeLoop(): Promise<void> {
    try {
      while (this.dirty) {
        this.dirty = false;
        const tmp = `${this.path}.tmp`;
        await writeFile(tmp, JSON.stringify(this.values));
        await rename(tmp, this.path);
      }
    } catch {
      // Disk full or read-only: the in-memory counters still enforce the caps until a restart.
    } finally {
      this.writing = null;
    }
  }
}

export interface CreditGuard {
  /** Adds `amount` to today's usage if it fits under the cap. False means refuse the work. */
  checkAndReserve(kind: CreditKind, amount: number): boolean;
  /** Settles a reservation: replaces the reserved estimate with what was really used. */
  record(kind: CreditKind, actual: number, reserved: number): void;
  isExhausted(): boolean;
  /** ISO time of the next reset. */
  resetAt(): string;
  usage(): { day: string; stt_seconds: number; tts_chars: number };
}

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

export class DailyCreditGuard implements CreditGuard {
  constructor(
    private readonly caps: { stt_seconds: number; tts_chars: number },
    private readonly store: CreditStore = new MemoryCreditStore(),
    private readonly now: () => number = Date.now,
  ) {}

  private day(): string {
    return new Date(this.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  }

  checkAndReserve(kind: CreditKind, amount: number): boolean {
    const day = this.day();
    if (this.store.get(day, kind) + amount > this.caps[kind]) return false;
    this.store.add(day, kind, amount);
    return true;
  }

  record(kind: CreditKind, actual: number, reserved: number): void {
    this.store.add(this.day(), kind, actual - reserved);
  }

  isExhausted(): boolean {
    const day = this.day();
    return (
      this.store.get(day, 'stt_seconds') >= this.caps.stt_seconds ||
      this.store.get(day, 'tts_chars') >= this.caps.tts_chars
    );
  }

  resetAt(): string {
    const local = this.now() + IST_OFFSET_MS;
    return new Date(Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - IST_OFFSET_MS).toISOString();
  }

  usage() {
    const day = this.day();
    return {
      day,
      stt_seconds: this.store.get(day, 'stt_seconds'),
      tts_chars: this.store.get(day, 'tts_chars'),
    };
  }
}
