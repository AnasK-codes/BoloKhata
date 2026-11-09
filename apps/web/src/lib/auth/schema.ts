import { z } from 'zod';
import { businessProfileSchema } from '@bolbill/shared';

export const credentialsSchema = z.object({ email: z.email().max(254).transform((value) => value.trim().toLowerCase()), password: z.string().min(1).max(128) });
export const signupSchema = credentialsSchema.extend({ password: z.string().min(8).max(128) });
export const accountUserSchema = z.object({ id: z.uuid(), email: z.email() });
export const accountStateSchema = z.object({
  configured: z.boolean(), user: accountUserSchema.nullable(), profile: businessProfileSchema.nullable(),
  confirmationRequired: z.boolean().optional(),
  /** True while the temporary demo switch (DEMO_NO_AUTH) has login turned off. */
  demo: z.boolean().optional(),
});
export type AccountState = z.infer<typeof accountStateSchema>;
