import { z } from 'zod';
import { nameSchema, safeText } from '../protocol/common';
import type { Customer } from './types';

/** Contact information stays on the device, outside the voice protocol. */
export const creditDetailsSchema = z.object({
  name: nameSchema.transform((s) => s.trim()).pipe(z.string().min(1)),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, '10 digit mobile number likho.'),
  address: safeText(300).transform((s) => s.trim()).pipe(z.string().min(5, 'Poora address likho.')),
});

export function hasCreditDetails(customer: Pick<Customer, 'name' | 'mobile' | 'address'> | undefined): boolean {
  return creditDetailsSchema.safeParse(customer).success;
}

export const ADDRESS_MIN = 5;
export const ADDRESS_MAX = 300;
export const MOBILE_DIGITS = 10;

/** Why one field is wrong, as data: the interface turns the code into a sentence in its language. */
export type DetailIssue =
  | { field: 'name'; code: 'nameMissing' }
  | { field: 'mobile'; code: 'mobileEmpty' }
  | { field: 'mobile'; code: 'mobileNotDigits'; chars: string }
  | { field: 'mobile'; code: 'mobileShort'; count: number; missing: number }
  | { field: 'mobile'; code: 'mobileLong'; count: number; extra: number }
  | { field: 'mobile'; code: 'mobileStart'; digit: string }
  | { field: 'address'; code: 'addressEmpty' }
  | { field: 'address'; code: 'addressShort'; count: number; min: number }
  | { field: 'address'; code: 'addressLong'; count: number; max: number };

/**
 * Every problem with the credit details, one per field, with the numbers behind it ("7 digits, 3
 * more needed"). Empty when the details are good. Agrees with `creditDetailsSchema`: the same
 * input passes one exactly when it passes the other.
 */
export function creditDetailIssues(input: { name: string; mobile: string; address: string }): DetailIssue[] {
  const issues: DetailIssue[] = [];
  if (input.name.trim() === '') issues.push({ field: 'name', code: 'nameMissing' });

  const mobile = input.mobile.trim();
  const odd = [...new Set(mobile.replace(/\d/g, '').split(''))].join('').slice(0, 6);
  if (mobile === '') issues.push({ field: 'mobile', code: 'mobileEmpty' });
  else if (odd !== '') issues.push({ field: 'mobile', code: 'mobileNotDigits', chars: odd });
  else if (mobile.length < MOBILE_DIGITS) issues.push({ field: 'mobile', code: 'mobileShort', count: mobile.length, missing: MOBILE_DIGITS - mobile.length });
  else if (mobile.length > MOBILE_DIGITS) issues.push({ field: 'mobile', code: 'mobileLong', count: mobile.length, extra: mobile.length - MOBILE_DIGITS });
  else if (!/^[6-9]/.test(mobile)) issues.push({ field: 'mobile', code: 'mobileStart', digit: mobile.charAt(0) });

  const address = input.address.trim();
  if (address === '') issues.push({ field: 'address', code: 'addressEmpty' });
  else if (address.length < ADDRESS_MIN) issues.push({ field: 'address', code: 'addressShort', count: address.length, min: ADDRESS_MIN });
  else if (address.length > ADDRESS_MAX) issues.push({ field: 'address', code: 'addressLong', count: address.length, max: ADDRESS_MAX });
  return issues;
}
