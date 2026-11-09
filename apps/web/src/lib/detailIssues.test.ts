import { describe, expect, it } from 'vitest';
import { translate, type Translate } from './i18n';
import { detailErrors } from './detailIssues';

const t: Translate = (key, params) => translate('en', key, params);
const good = { name: 'Synthetic Customer', mobile: '9876543210', address: '12 Demo Lane, Test Nagar' };

describe('detailErrors', () => {
  it('is empty for good details', () => {
    expect(detailErrors(t, good)).toEqual({});
  });

  it('says what is wrong and why, with the numbers, under the field that is wrong', () => {
    const e = detailErrors(t, { name: 'A', mobile: '98765', address: 'abc' });
    expect(e.mobile).toMatch(/5 digits/);
    expect(e.mobile).toMatch(/10/);
    expect(e.mobile).toMatch(/5 more/);
    expect(e.address).toMatch(/3 letters/);
    expect(e.address).toMatch(/at least 5/);
    expect(e.name).toBeUndefined();
  });

  it('names the characters that do not belong in a mobile number', () => {
    expect(detailErrors(t, { ...good, mobile: '98765x4321' }).mobile).toContain('x');
  });

  it('explains a wrong first digit', () => {
    expect(detailErrors(t, { ...good, mobile: '1234567890' }).mobile).toMatch(/starts with 6, 7, 8 or 9, not 1/);
  });

  it('never leaves the old one-line catch-all as the only message', () => {
    for (const bad of [{ ...good, mobile: '' }, { ...good, address: '' }, { ...good, name: '' }]) {
      const messages = Object.values(detailErrors(t, bad));
      expect(messages).toHaveLength(1);
      expect(messages[0]).not.toMatch(/Fill in the name, a 10-digit mobile and the full address/);
    }
  });
});
