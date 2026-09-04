import { Space_Grotesk, Inter, Playfair_Display, Lora, Poppins, Nunito } from "next/font/google";
import type { FontChoice } from "@/domain/entities/landing";

/**
 * 3 choix de police prédéfinis pour la personnalisation de marque (cahier
 * Lot K, section "Sélecteur ... de police (3 choix déjà existants dans
 * src/app/fonts.ts)"). Ce fichier N'EXISTAIT PAS avant ce lot — vérifié
 * par recherche exhaustive (`grep -r "fonts"` sur tout le projet, voir
 * RAPPORT_LOT_K.md) — le cahier supposait à tort qu'il avait déjà été
 * construit par un lot antérieur. Créé ici en respectant l'intention du
 * cahier : exactement 3 choix nommés, jamais de police arbitraire/
 * dynamique.
 *
 * "modern" reprend VOLONTAIREMENT exactement les mêmes polices que
 * `src/app/layout.tsx` (Space Grotesk / Inter) : c'est le rendu déjà
 * utilisé aujourd'hui par la plateforme, donc le choix qui NE CHANGE
 * RIEN visuellement — cohérent avec `font_choice` par défaut = "modern"
 * (voir landing-config-service.ts) pour toute organisation qui n'a
 * jamais personnalisé sa page.
 *
 * Réutilise le même nom de variable CSS (`--font-display`/`--font-body`)
 * pour les 3 choix : sans risque, puisqu'une seule des 3 classes
 * `.variable` est appliquée à la fois (sur le wrapper de la vitrine
 * publique, voir tenant-branding.ts::resolveTenantFontClassName) — la
 * variable est ainsi scopée au sous-arbre DOM concerné, exactement comme
 * `tailwind.config.ts` s'y attend déjà (`fontFamily.display`/`body`
 * pointent sur ces mêmes noms de variable).
 */
const modernDisplay = Space_Grotesk({ subsets: ["latin"], variable: "--font-display", weight: ["500", "700"] });
const modernBody = Inter({ subsets: ["latin"], variable: "--font-body" });

const classicDisplay = Playfair_Display({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700"] });
const classicBody = Lora({ subsets: ["latin"], variable: "--font-body" });

const friendlyDisplay = Poppins({ subsets: ["latin"], variable: "--font-display", weight: ["600", "700"] });
const friendlyBody = Nunito({ subsets: ["latin"], variable: "--font-body" });

export const TENANT_FONT_VARIABLES: Record<FontChoice, string> = {
  modern: `${modernDisplay.variable} ${modernBody.variable}`,
  classic: `${classicDisplay.variable} ${classicBody.variable}`,
  friendly: `${friendlyDisplay.variable} ${friendlyBody.variable}`,
};

export const FONT_CHOICE_LABELS: Record<FontChoice, string> = {
  modern: "Moderne (Space Grotesk / Inter)",
  classic: "Classique (Playfair Display / Lora)",
  friendly: "Chaleureux (Poppins / Nunito)",
};
