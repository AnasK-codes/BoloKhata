import { describe, expect, it } from 'vitest';
import { normalizeGatewayUrl } from './env';

describe('normalizeGatewayUrl', () => {
  it('falls back to the local gateway when unset or blank', () => {
    expect(normalizeGatewayUrl(undefined)).toBe('http://localhost:8080');
    expect(normalizeGatewayUrl('   ')).toBe('http://localhost:8080');
  });

  it('strips trailing slashes', () => {
    expect(normalizeGatewayUrl('https://bol.example.test//')).toBe('https://bol.example.test');
  });
});
