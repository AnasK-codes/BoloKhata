import { describe, expect, it } from 'vitest';
import { businessProfileSchema, receiptBusiness } from './business';

const profile = { businessName: 'Synthetic Kirana', ownerName: 'Synthetic Owner', mobile: '9000000000', address: 'Synthetic Lane, Demo Nagar', receiptFooter: 'Thank you' };
describe('business profile', () => {
  it('validates and trims details; receipt snapshots omit the private owner name', () => {
    const parsed = businessProfileSchema.parse({ ...profile, businessName: ' Synthetic Kirana ' });
    expect(parsed.businessName).toBe('Synthetic Kirana');
    expect(receiptBusiness(parsed)).not.toHaveProperty('ownerName');
  });
  it.each([{ businessName: ' ' }, { ownerName: '' }, { mobile: '1234' }, { address: 'abc' }, { receiptFooter: 'x'.repeat(161) }])('rejects incomplete or oversized fields: %j', (patch) => {
    expect(businessProfileSchema.safeParse({ ...profile, ...patch }).success).toBe(false);
  });
});
