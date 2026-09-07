import { z } from "zod";

export const ContactSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  fullName: z.string().nullable(),
  phoneE164: z.string().nullable(),
  email: z.string().email().nullable(),
  sourceChannel: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Contact = z.infer<typeof ContactSchema>;

export const CreateContactInputSchema = z.object({
  organizationId: z.string().uuid(),
  fullName: z.string().optional(),
  phoneE164: z.string().optional(),
  email: z.string().email().optional(),
  sourceChannel: z.string().optional(),
});

export type CreateContactInput = z.infer<typeof CreateContactInputSchema>;
