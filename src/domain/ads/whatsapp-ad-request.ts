import { z } from "zod";

/**
 * Forme valide d'une demande de pub WhatsApp (partagée par le service C5 et l'adaptateur :
 * défense en profondeur, la même règle des deux côtés). Aucune dépendance d'infrastructure.
 */
const validDate = (d: string) => !Number.isNaN(Date.parse(d));

export const whatsAppAdRequestSchema = z.object({
  accountId: z.string().min(1),
  adAccountId: z.string().regex(/^act_\d+$/, "Identifiant de compte pub invalide (attendu act_…)"),
  name: z.string().trim().min(1).max(200),
  headline: z.string().trim().min(3).max(255),
  body: z.string().trim().min(1).max(2000),
  imageUrl: z.string().url().max(2000).refine((u) => u.startsWith("https://"), "URL https requise"),
  budgetAmount: z.number().positive().finite(),
  budgetType: z.enum(["daily", "lifetime"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  endDate: z.string().min(8).max(40).refine(validDate, "Date de fin invalide"),
  startDate: z.string().min(8).max(40).refine(validDate, "Date de début invalide").optional(),
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).min(1).max(20).optional(),
  welcomeMessage: z.object({ text: z.string().trim().min(1).max(500), prefillText: z.string().trim().min(1).max(500) }).strict().optional(),
  whatsappPhoneNumber: z.string().regex(/^\+?[1-9]\d{6,14}$/).optional(),
  campaignStatus: z.enum(["ACTIVE", "PAUSED"]).optional(),
}).strict();
