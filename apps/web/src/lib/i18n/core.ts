import type { LocaleMeta, Message } from './types';

export type Params = Readonly<Record<string, string | number>>;

const pluralRules = new Map<string, Intl.PluralRules>();
const countFormat = new Intl.NumberFormat('en-IN');

function rulesFor(intlLocale: string): Intl.PluralRules {
  let rules = pluralRules.get(intlLocale);
  if (!rules) {
    rules = new Intl.PluralRules(intlLocale);
    pluralRules.set(intlLocale, rules);
  }
  return rules;
}

/** Replaces `{name}` with the param. A placeholder with no param stays visible so the gap is easy to spot. */
export function interpolate(text: string, params: Params | undefined): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'number' ? countFormat.format(value) : value;
  });
}

/**
 * Picks the plural form for `params.count` with the language's own rules (Hindi treats 0 and 1
 * as "one"; English only 1), then fills the placeholders. The whole sentence is one message, so
 * word order is always the translator's, never glued from fragments.
 */
export function formatMessage(message: Message, meta: Pick<LocaleMeta, 'intlLocale'>, params?: Params): string {
  if (typeof message === 'string') return interpolate(message, params);
  const count = typeof params?.count === 'number' ? params.count : 0;
  const category = rulesFor(meta.intlLocale).select(count) as keyof typeof message;
  return interpolate(message[category] ?? message.other, params);
}

/** Every `{placeholder}` in a message, across its plural forms. */
export function placeholders(message: Message): string[] {
  const texts = typeof message === 'string' ? [message] : Object.values(message).filter((v): v is string => typeof v === 'string');
  const names = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(/\{(\w+)\}/g)) if (match[1]) names.add(match[1]);
  return [...names].sort();
}

/**
 * The language to start with when the user has not chosen one: Hindi for a Hindi browser,
 * Hinglish for any other Indian locale (the way most shopkeepers read and type), English for an
 * English browser outside India, and Hinglish when nothing matches (the app is for Indian shops).
 */
export function pickDefaultLocale(browserLanguages: readonly string[], available: readonly string[]): string {
  const has = (id: string) => available.includes(id);
  for (const raw of browserLanguages) {
    const tag = raw.toLowerCase();
    if (tag === 'hi-latn' && has('hi-Latn')) return 'hi-Latn';
    if ((tag === 'hi' || tag.startsWith('hi-')) && has('hi')) return 'hi';
    if (tag.endsWith('-in') && has('hi-Latn')) return 'hi-Latn';
    const exact = available.find((id) => id.toLowerCase() === tag || id.toLowerCase() === tag.split('-')[0]);
    if (exact) return exact;
  }
  return has('hi-Latn') ? 'hi-Latn' : (available[0] ?? 'en');
}

/** A saved id is trusted only if it is still one of ours (a removed language falls back cleanly). */
export function parseSavedLocale(raw: string | null, available: readonly string[]): string | null {
  return raw !== null && available.includes(raw) ? raw : null;
}
