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
