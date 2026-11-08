import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { DIALECTS, type Dialect } from '@bolbill/shared';
import { DEFAULT_MIC_SETTINGS, type MicSettings } from './audio/micCapture';

export interface Settings {
  /** Show the latency HUD on the voice screen. */
  hud: boolean;
  /** After the readback, listen briefly for "haan" / "nahi" without a tap. Off by default. */
  handsFree: boolean;
  mic: MicSettings;
  /** How the shopkeeper speaks. Picks the parser's regional word list on the gateway. */
  dialect: Dialect;
}

const KEY = 'bolbill.settings.v1';

export const DEFAULT_SETTINGS: Settings = { hud: false, handsFree: false, mic: DEFAULT_MIC_SETTINGS, dialect: 'auto' };

/** Reads saved settings; anything missing or malformed falls back to the default. */
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<Settings> & { mic?: Partial<MicSettings> };
    const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
    return {
      hud: bool(value.hud, DEFAULT_SETTINGS.hud),
      handsFree: bool(value.handsFree, DEFAULT_SETTINGS.handsFree),
      mic: {
        echoCancellation: bool(value.mic?.echoCancellation, DEFAULT_MIC_SETTINGS.echoCancellation),
        noiseSuppression: bool(value.mic?.noiseSuppression, DEFAULT_MIC_SETTINGS.noiseSuppression),
        autoGainControl: bool(value.mic?.autoGainControl, DEFAULT_MIC_SETTINGS.autoGainControl),
      },
      dialect: (DIALECTS as readonly unknown[]).includes(value.dialect) ? (value.dialect as Dialect) : DEFAULT_SETTINGS.dialect,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function load(): Settings {
  try {
    return parseSettings(globalThis.localStorage?.getItem(KEY) ?? null);
  } catch {
    return DEFAULT_SETTINGS; // storage blocked (private window)
  }
}

export type SettingsStore = StoreApi<Settings & { set(patch: Partial<Settings>): void }>;

export const settingsStore: SettingsStore = createStore((set, get) => ({
  ...DEFAULT_SETTINGS,
  set(patch) {
    set(patch);
    const { set: _set, ...settings } = get();
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable: the setting still applies for this visit
    }
  },
}));

/** Called once on the client after hydration, so server and first client render agree. */
export function hydrateSettings(): void {
  settingsStore.setState(load());
}

export function useSettings<T>(selector: (s: Settings & { set(patch: Partial<Settings>): void }) => T): T {
  return useStore(settingsStore, selector);
}
