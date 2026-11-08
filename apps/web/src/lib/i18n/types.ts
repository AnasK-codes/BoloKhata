/** A plural message: one form per CLDR plural category the language uses; `other` is required. */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A message is plain text with `{name}` placeholders, or a set of plural forms chosen by `{count}`. */
export type Message = string | PluralMessage;

export interface LocaleMeta {
  /** BCP 47 id, also the value saved on the device. */
  id: string;
  /** The language's name in its own script, shown in the picker whatever the current language is. */
  nativeName: string;
  /** A short English name for screen readers and docs. */
  englishName: string;
  /** Value for `<html lang>`. */
  htmlLang: string;
  /** Locale for Intl plural rules and dates. Money always uses Indian digit grouping. */
  intlLocale: string;
  /**
   * `reviewed`: checked by a fluent speaker. `needs-review`: written carefully but not yet checked
   * by a native speaker; the picker labels it "beta" so it never ships silently.
   */
  status: 'reviewed' | 'needs-review';
}
