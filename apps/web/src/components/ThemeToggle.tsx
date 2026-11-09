'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { useT } from '@/lib/i18n';
import { effectiveTheme, nextTheme, systemPrefersDark, useTheme } from '@/lib/theme';

/** One tap flips light and dark; the icon shows what a tap will switch to. Settings has the full choice. */
export function ThemeToggle({ className = 'vs-icon-btn' }: { className?: string }) {
  const t = useT();
  const theme = useTheme((s) => s.theme);
  const set = useTheme((s) => s.set);
  // "system" depends on the phone, which the server cannot know: read it after mount.
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    setSystemDark(systemPrefersDark());
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  const showing = effectiveTheme(theme, systemDark);
  return (
    <button type="button" className={className} aria-label={showing === 'dark' ? t('theme.toLight') : t('theme.toDark')} onClick={() => set(nextTheme(theme, systemDark))}>
      <Icon name={showing === 'dark' ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
