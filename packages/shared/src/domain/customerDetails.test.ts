import { describe, expect, it } from 'vitest';
import { creditDetailIssues, creditDetailsSchema } from './customerDetails';

const good = { name: 'Synthetic Customer', mobile: '9876543210', address: '12 Demo Lane, Test Nagar' };
const issues = (patch: Partial<typeof good>) => creditDetailIssues({ ...good, ...patch });

describe('creditDetailIssues', () => {
  it('has nothing to say about good details', () => {
    expect(issues({})).toEqual([]);
  });

  it('names a missing customer', () => {
    expect(issues({ name: '  ' })).toEqual([{ field: 'name', code: 'nameMissing' }]);
  });

  it.each([
    ['', { code: 'mobileEmpty' }],
    ['   ', { code: 'mobileEmpty' }],
    ['98765abc10', { code: 'mobileNotDigits', chars: 'abc' }],
    ['98765-43210', { code: 'mobileNotDigits', chars: '-' }],
    ['+919876543210', { code: 'mobileNotDigits', chars: '+' }],
    ['98765', { code: 'mobileShort', count: 5, missing: 5 }],
    ['987654321', { code: 'mobileShort', count: 9, missing: 1 }],
    ['98765432101', { code: 'mobileLong', count: 11, extra: 1 }],
    ['5876543210', { code: 'mobileStart', digit: '5' }],
    ['0876543210', { code: 'mobileStart', digit: '0' }],
  ])('mobile %j', (mobile, expected) => {
    expect(issues({ mobile })).toEqual([{ field: 'mobile', ...expected }]);
  });

  it.each([
    ['', { code: 'addressEmpty' }],
    ['abcd', { code: 'addressShort', count: 4, min: 5 }],
    ['  ab  ', { code: 'addressShort', count: 2, min: 5 }],
    ['x'.repeat(301), { code: 'addressLong', count: 301, max: 300 }],
  ])('address %j', (address, expected) => {
    expect(issues({ address })).toEqual([{ field: 'address', ...expected }]);
  });

  it('reports every wrong field at once, in form order', () => {
    expect(issues({ name: '', mobile: '12', address: '' }).map((i) => i.code)).toEqual(['nameMissing', 'mobileShort', 'addressEmpty']);
  });

  it('agrees with the schema the save uses, for a spread of inputs', () => {
    const mobiles = ['', '9876543210', '987654321', '98765432100', '5876543210', 'abcdefghij', '9876 543210', ' 9876543210 '];
    const addresses = ['', 'abcd', 'abcde', 'x'.repeat(300), 'x'.repeat(301)];
    const names = ['', 'A'];
    for (const name of names) for (const mobile of mobiles) for (const address of addresses) {
      const input = { name, mobile, address };
      expect(creditDetailIssues(input).length === 0, JSON.stringify(input)).toBe(creditDetailsSchema.safeParse(input).success);
    }
  });
});
