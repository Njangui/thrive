import type { CSSProperties } from "react";
import { TENANT_FONT_VARIABLES } from "@/app/fonts";
import type { FontChoice } from "@/domain/entities/landing";

/**
 * N'EXISTAIT PAS avant ce lot, malgré ce que le cahier Lot K supposait
 * ("existant, src/lib/tenant-branding.ts") — vérifié par recherche
 * exhaustive sur tout le projet (voir RAPPORT_LOT_K.md). En revanche,
 * `tailwind.config.ts` avait DÉJÀ posé les variables CSS `--brand-primary`
 * / `--brand-secondary` (avec un commentaire explicite disant qu'elles
 * n'étaient "pas encore branchées") — ce fichier est ce branchement.
 *
 * Volontairement un simple objet `style` inline plutôt qu'un second
 * mécanisme de theming : les classes Tailwind `bg-brand`/`text-brand`/
 * `border-brand` existent déjà et consomment ces variables — il suffit de
 * les définir sur un ancêtre DOM pour qu'elles s'appliquent à tout le
 * sous-arbre (CSS custom properties = héritées par nature).
 */
export interface TenantBrandingInput {
  brandColorPrimary: string | null;
  brandColorSecondary: string | null;
}

/**
 * Couleurs de marque -> variables CSS scopées. Omet volontairement la clé
 * quand la couleur est `null` : la règle `var(--brand-primary, #0f172a)`
 * déjà posée dans `tailwind.config.ts` retombe alors sur la couleur par
 * défaut de la plateforme, sans qu'on ait besoin de dupliquer cette
 * valeur par défaut ici.
 */
export function getTenantBrandingStyle(input: TenantBrandingInput): CSSProperties {
  const vars: Record<string, string> = {};
  if (input.brandColorPrimary) vars["--brand-primary"] = input.brandColorPrimary;
  if (input.brandColorSecondary) vars["--brand-secondary"] = input.brandColorSecondary;
  // Cast nécessaire : les propriétés CSS custom (`--xxx`) ne font pas
  // partie du type `CSSProperties` standard de React, alors que
  // React les applique correctement au DOM (voir doc React sur les
  // "CSS custom properties").
  return vars as CSSProperties;
}

/**
 * Police choisie -> classes `next/font` à appliquer sur le même ancêtre
 * DOM que `getTenantBrandingStyle` (typiquement le conteneur racine de la
 * vitrine publique). `null`/`undefined`/valeur inconnue retombent tous
 * sur "modern" (repli défensif — jamais un rendu sans police, cohérent
 * avec `getLandingConfig` qui garantit déjà `fontChoice: "modern"` par
 * défaut, ce repli couvre les appelants qui n'y passent pas par ce
 * chemin).
 */
export function resolveTenantFontClassName(fontChoice: FontChoice | string | null | undefined): string {
  if (fontChoice && fontChoice in TENANT_FONT_VARIABLES) {
    return TENANT_FONT_VARIABLES[fontChoice as FontChoice];
  }
  return TENANT_FONT_VARIABLES.modern;
}
