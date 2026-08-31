import { z } from "zod";

export const FaqSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  question: z.string(),
  answer: z.string(),
  keywords: z.array(z.string()),
  isActive: z.boolean(),
});

export type Faq = z.infer<typeof FaqSchema>;
