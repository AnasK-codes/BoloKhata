import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(SPIKE_DIR, '..', '..');

const DEFAULT_STT_URL = 'wss://api.vachana.ai/stt/v3/stream';
const DEFAULT_TTS_URL = 'wss://api.vachana.ai/api/v1/tts';

export interface SpikeEnv {
  sttUrl: string;
  ttsUrl: string;
  /** Never printed or written anywhere. */
  apiKey: string | null;
  /** True when an endpoint is not Gnani's. Mock results must never be presented as real numbers. */
  mock: boolean;
}

/** Minimal .env reader (KEY=value lines). Variables already in the environment win. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || line.trimStart().startsWith('#')) continue;
    const [, key, raw] = match;
    if (key === undefined || raw === undefined || process.env[key] !== undefined) continue;
    process.env[key] = raw.replace(/^(['"])(.*)\1$/, '$2');
  }
}

function isGnaniHost(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('vachana.ai');
  } catch {
    return false;
  }
}

export function loadSpikeEnv(): SpikeEnv {
  loadDotEnv(path.join(ROOT_DIR, '.env'));
  const sttUrl = process.env['GNANI_STT_URL'] ?? DEFAULT_STT_URL;
  const ttsUrl = process.env['GNANI_TTS_URL'] ?? DEFAULT_TTS_URL;
  const rawKey = process.env['GNANI_API_KEY'];
  const apiKey = rawKey && rawKey !== 'replace-me' ? rawKey : null;
  return { sttUrl, ttsUrl, apiKey, mock: !isGnaniHost(sttUrl) || !isGnaniHost(ttsUrl) };
}
