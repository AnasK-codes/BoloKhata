import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Phrase cache for repeated spoken replies: a byte-bounded LRU in memory, backed by one raw-PCM
 * file per phrase on disk. Only fixed phrases should be cached (no customer names or amounts):
 * the key is a hash, but the audio itself would still contain whatever was spoken.
 */
export interface PhraseKeyParts {
  text: string;
  voice: string;
  model: string;
  language: string;
  sampleRate: number;
}

/** Everything that changes the audio is part of the key. */
export function phraseCacheKey(parts: PhraseKeyParts): string {
  const material = [parts.text, parts.voice, parts.model, parts.language, parts.sampleRate].join('\u0000');
  return createHash('sha256').update(material).digest('hex');
}

const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

export class PhraseCache {
  hits = 0;
  misses = 0;
  private readonly memory = new Map<string, Uint8Array>();
  private memoryBytes = 0;

  /** `dir` null disables the disk layer. */
  constructor(
    private readonly dir: string | null,
    private readonly maxMemoryBytes: number,
  ) {}

  get bytesInMemory(): number {
    return this.memoryBytes;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const inMemory = this.memory.get(key);
    if (inMemory) {
      this.memory.delete(key); // re-insert to mark as most recently used
      this.memory.set(key, inMemory);
      this.hits++;
      return inMemory;
    }
    const fromDisk = await this.readDisk(key);
    if (fromDisk) {
      this.remember(key, fromDisk);
      this.hits++;
      return fromDisk;
    }
    this.misses++;
    return null;
  }

  async set(key: string, pcm: Uint8Array): Promise<void> {
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0 || pcm.byteLength > MAX_ENTRY_BYTES) return;
    this.remember(key, pcm);
    await this.writeDisk(key, pcm);
  }

  /** Whether the phrase is already on disk or in memory (used by the warm-up dry run). */
  async has(key: string): Promise<boolean> {
    return this.memory.has(key) || (await this.readDisk(key)) !== null;
  }

  private remember(key: string, pcm: Uint8Array): void {
    if (pcm.byteLength > this.maxMemoryBytes) return;
    const existing = this.memory.get(key);
    if (existing) this.memoryBytes -= existing.byteLength;
    this.memory.delete(key);
    this.memory.set(key, pcm);
    this.memoryBytes += pcm.byteLength;
    for (const [oldest, value] of this.memory) {
      if (this.memoryBytes <= this.maxMemoryBytes) break;
      this.memory.delete(oldest);
      this.memoryBytes -= value.byteLength;
    }
  }

  private file(key: string): string | null {
    return this.dir === null ? null : path.join(this.dir, `${key}.pcm`);
  }

  private async readDisk(key: string): Promise<Uint8Array | null> {
    const file = this.file(key);
    if (file === null) return null;
    try {
      const data = await readFile(file);
      // A truncated or foreign file is a miss, never garbage played to a customer.
      if (data.byteLength === 0 || data.byteLength % 2 !== 0 || data.byteLength > MAX_ENTRY_BYTES) {
        return null;
      }
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch {
      return null;
    }
  }

  private async writeDisk(key: string, pcm: Uint8Array): Promise<void> {
    const file = this.file(key);
    if (file === null || this.dir === null) return;
    try {
      await mkdir(this.dir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, pcm);
      await rename(temp, file); // atomic: a reader never sees half a file
    } catch {
      // The disk layer is an optimisation; failing to write it must not fail a turn.
    }
  }
}
