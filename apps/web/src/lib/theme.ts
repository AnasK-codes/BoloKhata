import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

/**
 * Light or dark, chosen by the person. "system" follows the phone (the default). The choice is
 * saved on this device and applied as `data-theme` on <html> before the first paint (see
 * `themeBootScript`), so there is no flash; the CSS reads `data-theme` next to prefers-color-scheme.
 */
export type Theme = 'system' | 'light' | 'dark';
export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];
export const THEME_KEY = 'bolbill.theme.v1';
export const themeColor = { light: '#f2f2f6', dark: '#000000' } as const;

export const parseTheme = (raw: string | null): Theme => (THEMES as readonly (string | null)[]).includes(raw) ? (raw as Theme) : 'system';

/** What is actually on screen. */
export const effectiveTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' => (theme === 'system' ? (systemDark ? 'dark' : 'light') : theme);

/** The toggle button flips what is on screen, so one tap always changes something. */
export const nextTheme = (theme: Theme, systemDark: boolean): 'light' | 'dark' => (effectiveTheme(theme, systemDark) === 'dark' ? 'light' : 'dark');

interface RootLike { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }
interface MetaLike { content: string; media?: string }

/** Applies the choice to the page. `metas` are the theme-color tags (the browser bar colour). */
export function applyTheme(theme: Theme, root: RootLike, metas: readonly MetaLike[]): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  for (const meta of metas) {
    const own = meta.media?.includes('dark') ? themeColor.dark : themeColor.light;
    meta.content = theme === 'system' ? own : themeColor[theme];
  }
}

/** Runs in <head> before anything paints. Plain text so it can be inlined; keep it tiny and dependency-free. */
export const themeBootScript = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export const themeStore = createStore<{ theme: Theme; set(theme: Theme): void }>((set) => ({
  theme: 'system',
  set(theme) {
    set({ theme });
    try { globalThis.localStorage?.setItem(THEME_KEY, theme); } catch { /* storage blocked: it still applies for this visit */ }
    applyToDocument(theme);
  },
}));

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  applyTheme(theme, document.documentElement, Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')));
}

/** Called once on the client after hydration. */
export function hydrateTheme(): void {
  let saved: string | null = null;
  try { saved = globalThis.localStorage?.getItem(THEME_KEY) ?? null; } catch { /* blocked */ }
  const theme = parseTheme(saved);
  themeStore.setState({ theme });
  applyToDocument(theme);
}

export const useTheme = <T,>(selector: (s: { theme: Theme; set(theme: Theme): void }) => T): T => useStore(themeStore, selector);

/** Whether the phone itself is in dark mode (for the "system" choice). */
export const systemPrefersDark = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
