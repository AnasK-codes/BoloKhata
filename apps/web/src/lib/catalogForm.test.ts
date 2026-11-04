import { describe, expect, it } from 'vitest';
import { parseAliases, validateProductForm } from './catalogForm';

const ok = { name: 'Namak', price: '20', unit: 'kg', aliases: 'salt, nimak' };

describe('validateProductForm', () => {
  it('accepts a good product and normalises it', () => {
    expect(validateProductForm({ ...ok, name: '  Namak ' })).toEqual({ ok: true, value: { name: 'Namak', pricePerUnit: 20, unit: 'kg', aliases: ['salt', 'nimak'] } });
  });

  it.each(['', '0', '-5', '12.5', 'abc', '  '])('rejects the price %j', (price) => {
    const result = validateProductForm({ ...ok, price });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.price).toBeTruthy();
  });

  it('rejects an empty name and an unknown unit', () => {
    const result = validateProductForm({ ...ok, name: '   ', unit: 'bag' });
    expect(!result.ok && Object.keys(result.errors).sort()).toEqual(['name', 'unit']);
  });

  it('rejects too many aliases', () => {
    const many = Array.from({ length: 13 }, (_, i) => `a${i}`).join(',');
    expect(validateProductForm({ ...ok, aliases: many }).ok).toBe(false);
  });
});

describe('parseAliases', () => {
  it('splits on commas and newlines, trims, drops blanks and duplicates (ignoring case)', () => {
    expect(parseAliases(' atta , Atta,, ata\nchakki ')).toEqual(['atta', 'ata', 'chakki']);
    expect(parseAliases('')).toEqual([]);
  });
});
