'use client';

import { useLayoutEffect } from 'react';
import { getLocale, hydrateLocale, localeStore } from '@/lib/i18n';

/**
 * Applies the saved (or browser-default) interface language before the first paint, keeps
 * `<html lang>` in step so fonts, line breaking and screen readers follow it, and plays a short
 * fade on a switch. Opacity only, on one element, so it costs nothing on low-end phones.
 */
export function LocaleSync() {
  useLayoutEffect(() => {
    hydrateLocale();
    let current = localeStore.getState().locale;
    document.documentElement.lang = getLocale(current).meta.htmlLang;
    return localeStore.subscribe(({ locale }) => {
      if (locale === current) return;
      current = locale;
      document.documentElement.lang = getLocale(locale).meta.htmlLang;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      document.querySelector('.app-content')?.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 280, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    });
  }, []);
  return null;
}
