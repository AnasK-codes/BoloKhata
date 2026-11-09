'use client';

import { useLayoutEffect } from 'react';
import { hydrateTheme } from '@/lib/theme';

/** Applies the saved light/dark choice after hydration (the boot script already did it before paint). */
export function ThemeSync() {
  useLayoutEffect(() => { hydrateTheme(); }, []);
  return null;
}
