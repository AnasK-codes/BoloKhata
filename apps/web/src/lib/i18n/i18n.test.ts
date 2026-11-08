import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMessage, interpolate, parseSavedLocale, pickDefaultLocale, placeholders } from './core';
import { FALLBACK_LOCALE, LOCALES, hydrateLocale, localeStore, translate } from './index';
import en from './locales/en';

const SRC = join(__dirname, '..', '..');
const IDS = LOCALES.map((l) => l.meta.id);
const englishKeys = Object.keys(en.messages).sort();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('dictionaries', () => {
  it.each(LOCALES.map((l) => [l.meta.id, l] as const))('%s has exactly the English keys', (_id, locale) => {
    const keys = Object.keys(locale.messages).sort();
    expect(keys.filter((k) => !englishKeys.includes(k)), 'extra keys').toEqual([]);
    expect(englishKeys.filter((k) => !keys.includes(k)), 'missing keys').toEqual([]);
  });

  it.each(LOCALES.map((l) => [l.meta.id, l] as const))('%s uses the same placeholders as English', (_id, locale) => {
    const wrong = englishKeys.filter((key) => {
      const k = key as keyof typeof en.messages;
      return placeholders(locale.messages[k]).join() !== placeholders(en.messages[k]).join();
    });
    expect(wrong).toEqual([]);
  });

  it.each(LOCALES.map((l) => [l.meta.id, l] as const))('%s gives every plural message the forms its language needs', (_id, locale) => {
    const needed = new Intl.PluralRules(locale.meta.intlLocale).resolvedOptions().pluralCategories;
    for (const message of Object.values(locale.messages)) {
      if (typeof message === 'string') continue;
      for (const category of needed) expect(message[category] ?? message.other).toBeTruthy();
    }
  });

  it('has no empty strings', () => {
    for (const locale of LOCALES) for (const [key, message] of Object.entries(locale.messages)) {
      const texts = typeof message === 'string' ? [message] : Object.values(message);
      expect(texts.every((text) => typeof text === 'string' && text.trim() !== ''), `${locale.meta.id} ${key}`).toBe(true);
    }
  });

  it('names each language in its own script and marks unreviewed ones', () => {
    expect(LOCALES.map((l) => l.meta.nativeName)).toEqual(['Hinglish', 'हिन्दी', 'English']);
    expect(LOCALES.find((l) => l.meta.id === 'hi')?.meta.status).toBe('needs-review');
  });

  it('every key is used somewhere in the app (no dead keys)', () => {
    const code = sourceFiles(SRC)
      .filter((file) => !file.includes(join('lib', 'i18n', 'locales')))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const unused = englishKeys.filter((key) => !code.includes(`'${key}'`));
    expect(unused).toEqual([]);
  });
});

describe('formatting', () => {
  const enMeta = { intlLocale: 'en-IN' };
  const hiMeta = { intlLocale: 'hi-IN' };

  it('fills placeholders and groups numbers the Indian way', () => {
    expect(interpolate('{name} owes {amount}', { name: 'Sharma ji', amount: '₹1,25,000' })).toBe('Sharma ji owes ₹1,25,000');
    expect(interpolate('{count} items', { count: 125000 })).toBe('1,25,000 items');
    expect(interpolate('Hi {missing}', {})).toBe('Hi {missing}');
  });

  it('picks plural forms by each language’s rules', () => {
    const items = { one: '{count} item', other: '{count} items' };
    expect(formatMessage(items, enMeta, { count: 1 })).toBe('1 item');
    expect(formatMessage(items, enMeta, { count: 0 })).toBe('0 items');
    expect(formatMessage(items, enMeta, { count: 2 })).toBe('2 items');
    // Hindi counts 0 and 1 as "one".
    const hindi = { one: '{count} सामान जोड़ा', other: '{count} सामान जोड़ दिए' };
    expect(formatMessage(hindi, hiMeta, { count: 0 })).toBe('0 सामान जोड़ा');
    expect(formatMessage(hindi, hiMeta, { count: 3 })).toBe('3 सामान जोड़ दिए');
  });

  it('translates real keys in every language', () => {
    expect(translate('en', 'bill.items', { count: 1 })).toBe('1 item');
    expect(translate('en', 'bill.items', { count: 3 })).toBe('3 items');
    expect(translate('hi-Latn', 'ledger.received', { amount: '₹200' })).toBe('₹200 mil gaye');
    expect(translate('hi', 'ledger.received', { amount: '₹200' })).toBe('₹200 मिल गए');
    expect(translate('hi', 'voice.khataOwing', { count: 2 })).toBe('2 ग्राहकों का उधार बाकी');
  });

  it('falls back to Hinglish for an unknown language id', () => {
    expect(translate('xx', 'nav.ledger')).toBe('Khata');
  });
});

describe('choosing a language', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localeStore.setState({ locale: FALLBACK_LOCALE });
  });

  it('defaults sensibly from the browser languages', () => {
    expect(pickDefaultLocale(['hi-IN', 'en'], IDS)).toBe('hi');
    expect(pickDefaultLocale(['hi'], IDS)).toBe('hi');
    expect(pickDefaultLocale(['en-IN'], IDS)).toBe('hi-Latn');
    expect(pickDefaultLocale(['mr-IN'], IDS)).toBe('hi-Latn');
    expect(pickDefaultLocale(['en-US'], IDS)).toBe('en');
    expect(pickDefaultLocale(['en-GB', 'hi-IN'], IDS)).toBe('en');
    expect(pickDefaultLocale(['fr-FR'], IDS)).toBe('hi-Latn');
    expect(pickDefaultLocale([], IDS)).toBe('hi-Latn');
  });

  it('trusts a saved choice only if it is still offered', () => {
    expect(parseSavedLocale('hi', IDS)).toBe('hi');
    expect(parseSavedLocale('ta', IDS)).toBeNull();
    expect(parseSavedLocale(null, IDS)).toBeNull();
  });

  it('saves a switch and restores it on the next launch', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
    vi.stubGlobal('navigator', { language: 'en-US', languages: ['en-US'] });

    hydrateLocale();
    expect(localeStore.getState().locale).toBe('en');

    localeStore.getState().setLocale('hi');
    expect(storage.get('bolbill.locale.v1')).toBe('hi');

    localeStore.setState({ locale: FALLBACK_LOCALE });
    hydrateLocale();
    expect(localeStore.getState().locale).toBe('hi');
  });

  it('ignores an unknown id and still works when storage is blocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    vi.stubGlobal('navigator', { language: 'hi-IN', languages: ['hi-IN'] });
    hydrateLocale();
    expect(localeStore.getState().locale).toBe('hi');
    localeStore.getState().setLocale('zz');
    expect(localeStore.getState().locale).toBe('hi');
    localeStore.getState().setLocale('en');
    expect(localeStore.getState().locale).toBe('en');
  });
});

/**
 * Guards against UI text written straight into components. It parses each component with the
 * TypeScript compiler and flags JSX text, user-facing attributes (aria-label, placeholder, title,
 * alt) and capitalised multi-word string literals (toasts, errors). Developer-only lab pages
 * under app/dev and lines marked `i18n-ignore` are skipped.
 */
describe('no hard-coded interface text', () => {
  const files = sourceFiles(SRC).filter((f) => f.endsWith('.tsx') && !f.includes(join('app', 'dev')));
  const LETTERS = /[A-Za-z]{2,}|\p{Script=Devanagari}{2,}/u;
  const ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'alt']);

  function findHardCoded(file: string): string[] {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const hits: string[] = [];
    const report = (node: ts.Node, kind: string, value: string) => {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
      if (!lines[line]?.includes('i18n-ignore')) hits.push(`${line + 1} (${kind}): ${value.trim().slice(0, 80)}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) return;
      if (ts.isJsxText(node) && LETTERS.test(node.text.replace(/&\w+;/g, ''))) report(node, 'JSX text', node.text);
      if (ts.isJsxAttribute(node) && ATTRIBUTES.has(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer) && LETTERS.test(node.initializer.text)) {
        report(node, 'attribute', node.initializer.text);
      }
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && /^[A-Z][a-z]+ [a-z]/.test(node.text) && !(node.parent && ts.isJsxAttribute(node.parent))) {
        report(node, 'string', node.text);
      }
      // Class names are templates too; only text outside className/style counts.
      const inClassName = node.parent !== undefined && ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent) && ['className', 'style'].includes(node.parent.parent.name.getText(source));
      if (!inClassName && ts.isTemplateExpression(node) && /[A-Za-z]{3,} [a-z]{2,}/.test(node.head.text + node.templateSpans.map((s) => s.literal.text).join(' '))) {
        report(node, 'template', node.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return hits;
  }

  it.each(files.map((f) => [relative(SRC, f), f] as const))('%s', (_name, file) => {
    expect(findHardCoded(file)).toEqual([]);
  });

  it('catches planted text (self-test)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'i18n-'));
    const file = join(dir, 'Planted.tsx');
    writeFileSync(file, [
      "export const A = ({ ok }: { ok: boolean }) => <p className={`a ${ok ? 'b' : 'c'}`} aria-label=\"Kuch bhi\">Naya bill</p>;",
      "export const msg = (n: number) => toast('Bill save ho gaya');",
      "export const ignored = 'Static meta text here'; // i18n-ignore: test",
    ].join('\n'));
    const hits = findHardCoded(file);
    rmSync(dir, { recursive: true });
    expect(hits.map((h) => h.split(' (')[1]?.split(')')[0])).toEqual(['attribute', 'JSX text', 'string']);
  });
});
