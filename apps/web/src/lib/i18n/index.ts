import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { formatMessage, parseSavedLocale, pickDefaultLocale, type Params } from './core';
import type { LocaleMeta, Message } from './types';
import en, { type MessageKey } from './locales/en';
import hi from './locales/hi';
import hiLatn from './locales/hi-Latn';

export type { MessageKey } from './locales/en';
export type { Params } from './core';

export interface Locale {
  meta: LocaleMeta;
  messages: Readonly<Record<MessageKey, Message>>;
}

/**
 * Every interface language, in picker order. To add one, drop a file in ./locales that exports a
 * `Locale` (TypeScript then lists any key it is missing) and add it here. All dictionaries ship in
 * the bundle: no network call, so switching works offline and instantly.
 */
export const LOCALES: readonly Locale[] = [hiLatn, hi, en];

const BY_ID = new Map(LOCALES.map((l) => [l.meta.id, l]));
const IDS = LOCALES.map((l) => l.meta.id);
const STORAGE_KEY = 'bolbill.locale.v1';
/** Server render and tests use Hinglish, the app's original copy. */
export const FALLBACK_LOCALE = 'hi-Latn';

export function getLocale(id: string): Locale {
  return BY_ID.get(id) ?? BY_ID.get(FALLBACK_LOCALE) ?? en;
}

/** A missing key in a translation falls back to English rather than showing a raw key. */
export function translate(localeId: string, key: MessageKey, params?: Params): string {
  const locale = getLocale(localeId);
  return formatMessage(locale.messages[key] ?? en.messages[key], locale.meta, params);
}

export type Translate = (key: MessageKey, params?: Params) => string;

interface LocaleState {
  locale: string;
  setLocale(id: string): void;
}

export const localeStore = createStore<LocaleState>((set) => ({
  locale: FALLBACK_LOCALE,
  setLocale(id) {
    if (!BY_ID.has(id)) return;
    set({ locale: id });
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, id);
    } catch {
      // storage blocked: the choice still applies for this visit
    }
  },
}));

/** Saved choice, else a default from the browser languages. Runs once on the client before first paint. */
export function hydrateLocale(): void {
  let saved: string | null;
  try {
    saved = parseSavedLocale(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null, IDS);
  } catch {
    saved = null;
  }
  const browser = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  localeStore.setState({ locale: saved ?? pickDefaultLocale(browser, IDS) });
}

/** For code outside React (toast text from a save, validation messages): uses the current language. */
export const t: Translate = (key, params) => translate(localeStore.getState().locale, key, params);

export function useLocale(): Locale {
  return getLocale(useStore(localeStore, (s) => s.locale));
}

/**
 * The translate function for a component. Subscribing to the locale makes the component re-render
 * on a switch; nothing on the audio path reads it, so a switch never touches a turn in progress.
 */
export function useT(): Translate {
  useStore(localeStore, (s) => s.locale);
  return t;
}

/** Short date in the current language, for example "8 Nov" or "8 नव॰". */
export function formatDateFor(ms: number, localeId = localeStore.getState().locale): string {
  return new Date(ms).toLocaleDateString(getLocale(localeId).meta.intlLocale, { day: 'numeric', month: 'short' });
}
