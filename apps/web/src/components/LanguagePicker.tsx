'use client';

import { useEffect, useRef } from 'react';
import { LOCALES, localeStore, useLocale, useT } from '@/lib/i18n';
import { Icon } from './Icon';

/**
 * The language choices. Each name is written in its own script ("हिन्दी", not "Hindi" in the
 * current language) so a shopkeeper can find theirs whatever is on screen. A language not yet
 * checked by a native speaker carries a "beta" tag.
 */
export function LanguageOptions({ onPicked }: { onPicked?: () => void }) {
  const t = useT();
  const active = useLocale().meta.id;
  return (
    <div role="radiogroup" aria-label={t('lang.title')} className="lang-list">
      {LOCALES.map(({ meta }) => {
        const checked = meta.id === active;
        return (
          <button
            key={meta.id}
            type="button"
            role="radio"
            aria-checked={checked}
            className="lang-opt"
            onClick={() => {
              localeStore.getState().setLocale(meta.id);
              onPicked?.();
            }}
          >
            <span lang={meta.htmlLang} className="lang-name">{meta.nativeName}</span>
            {meta.status === 'needs-review' && <span className="lang-beta" title={t('lang.betaHint')}>{t('lang.beta')}</span>}
            <span className="lang-check" aria-hidden="true"><Icon name="check" size={18} /></span>
          </button>
        );
      })}
    </div>
  );
}

/** A small bottom sheet opened from the globe button in the header. */
export function LanguageSheet({ onClose }: { onClose(): void }) {
  const t = useT();
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="lang-title">
        <div className="sheet-grabber" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <h2 id="lang-title" className="text-xl font-semibold tracking-tight">{t('lang.title')}</h2>
          <button type="button" className="vs-icon-btn" aria-label={t('lang.close')} onClick={onClose}><Icon name="close" size={20} /></button>
        </div>
        <p className="mt-1 text-sm text-muted">{t('lang.hint')}</p>
        {/* Close a beat after the pick so the check mark visibly moves first. */}
        <div className="mt-4"><LanguageOptions onPicked={() => window.setTimeout(onClose, 260)} /></div>
      </div>
    </div>
  );
}
