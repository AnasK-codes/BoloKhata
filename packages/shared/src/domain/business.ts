import { z } from 'zod';
import { safeText } from '../protocol/common';

const trimmedText = (max: number) => safeText(max).transform((value) => value.trim()).pipe(z.string().min(1));

/** The initial template is deliberately one receipt layout with editable business details. */
export const businessProfileSchema = z.object({
  businessName: trimmedText(100),
  ownerName: trimmedText(80),
  address: trimmedText(300).pipe(z.string().min(5)),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/),
  receiptFooter: safeText(160).transform((value) => value.trim()).default('Dhanyavaad! Phir aaiye.'),
});
export type BusinessProfile = z.infer<typeof businessProfileSchema>;

/** Snapshot this on save so later profile edits never rewrite an old receipt. */
export const receiptBusinessSchema = businessProfileSchema.omit({ ownerName: true });
export type ReceiptBusiness = z.infer<typeof receiptBusinessSchema>;

export function receiptBusiness(profile: BusinessProfile): ReceiptBusiness {
  return receiptBusinessSchema.parse(profile);
}
