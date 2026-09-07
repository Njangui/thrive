import type { FontChoice } from "@/domain/entities/landing";
export const TENANT_FONT_VARIABLES: Record<FontChoice, string> = {
  modern: "--font-display --font-body",
  classic: "--font-display --font-body",
  friendly: "--font-display --font-body",
};
export const FONT_CHOICE_LABELS: Record<FontChoice, string> = {
  modern: "Moderne (Space Grotesk / Inter)",
  classic: "Classique (Playfair Display / Lora)",
  friendly: "Chaleureux (Poppins / Nunito)",
};
