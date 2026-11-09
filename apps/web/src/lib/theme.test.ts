import { describe, expect, it } from 'vitest';
import { THEME_KEY, applyTheme, effectiveTheme, nextTheme, parseTheme, themeColor } from './theme';

const fakeDoc = () => {
  const attrs = new Map<string, string>();
  const metas: { content: string; media?: string }[] = [{ content: 'x', media: '(prefers-color-scheme: light)' }, { content: 'y', media: '(prefers-color-scheme: dark)' }];
  return {
    attrs,
    metas,
    root: { setAttribute: (k: string, v: string) => attrs.set(k, v), removeAttribute: (k: string) => attrs.delete(k) },
  };
};

describe('parseTheme', () => {
  it('keeps the three known values and falls back to system for anything else', () => {
    for (const v of ['system', 'light', 'dark'] as const) expect(parseTheme(v)).toBe(v);
    for (const v of [null, '', 'Dark', 'blue', '1']) expect(parseTheme(v)).toBe('system');
  });
});

describe('effectiveTheme and nextTheme', () => {
  it('system follows the phone', () => {
    expect(effectiveTheme('system', true)).toBe('dark');
    expect(effectiveTheme('system', false)).toBe('light');
    expect(effectiveTheme('light', true)).toBe('light');
    expect(effectiveTheme('dark', false)).toBe('dark');
  });
  it('the button always flips what is on screen, even from "system"', () => {
    expect(nextTheme('system', true)).toBe('light');
    expect(nextTheme('system', false)).toBe('dark');
    expect(nextTheme('light', true)).toBe('dark');
    expect(nextTheme('dark', false)).toBe('light');
  });
});

describe('applyTheme', () => {
  it('sets data-theme for light and dark, and removes it for system', () => {
    const d = fakeDoc();
    applyTheme('dark', d.root, []);
    expect(d.attrs.get('data-theme')).toBe('dark');
    applyTheme('light', d.root, []);
    expect(d.attrs.get('data-theme')).toBe('light');
    applyTheme('system', d.root, []);
    expect(d.attrs.has('data-theme')).toBe(false);
  });
  it('keeps the browser bar colour in step with a forced theme', () => {
    const d = fakeDoc();
    applyTheme('dark', d.root, d.metas);
    expect(d.metas.map((m) => m.content)).toEqual([themeColor.dark, themeColor.dark]);
    applyTheme('light', d.root, d.metas);
    expect(d.metas.map((m) => m.content)).toEqual([themeColor.light, themeColor.light]);
    applyTheme('system', d.root, d.metas);
    expect(d.metas.map((m) => m.content)).toEqual([themeColor.light, themeColor.dark]); // each follows its own media query again
  });
  it('uses a storage key of its own', () => {
    expect(THEME_KEY).toBe('bolbill.theme.v1');
  });
});
