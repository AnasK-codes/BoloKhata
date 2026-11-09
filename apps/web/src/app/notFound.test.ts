import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import NotFound from './not-found';

describe('the 404 page', () => {
  const html = renderToStaticMarkup(createElement(NotFound));

  it('says what happened and how to get back, in the app language', () => {
    expect(html).toContain(translate('hi-Latn', 'notFound.title'));
    expect(html).toContain(translate('hi-Latn', 'notFound.hint'));
    expect(html).toContain(translate('hi-Latn', 'notFound.home'));
  });

  it('links home and to every main section', () => {
    for (const href of ['/app', '/ledger', '/bills', '/catalog']) expect(html).toContain(`href="${href}"`);
  });

  it('has one heading and shows the error code', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('404');
  });

  it('has a translation for every language it can be shown in', () => {
    for (const locale of ['en', 'hi-Latn', 'hi']) {
      for (const key of ['notFound.title', 'notFound.hint', 'notFound.home', 'notFound.code'] as const) {
        expect(translate(locale, key).trim(), `${locale} ${key}`).not.toBe('');
      }
    }
  });
});
