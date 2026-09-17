import type { CSSProperties } from "react";
import { TENANT_FONT_VARIABLES } from "@/app/fonts";
import type { FontChoice } from "@/domain/entities/landing";

/**
 * Couleurs de marque -> variables CSS scopées, posées sur le conteneur
 * racine de la vitrine. Les classes Tailwind `bg-brand`/`text-brand`/
 * `border-brand` (tailwind.config.ts) les consomment déjà ; les custom
 * properties étant héritées, il suffit de les définir sur un ancêtre.
 *
 * ÉVOLUTION (vitrine V2) : trois changements.
 *
 *  1. La couleur passée n'est plus « celle du commerçant ou le défaut de
 *     la plateforme » mais « celle du commerçant ou LE DÉFAUT DE SON
 *     SECTEUR » (résolu par `getStorefrontSite`). Une boutique, un
 *     restaurant et un salon qui n'ont rien personnalisé n'ont plus la
 *     même teinte.
 *
 *  2. Les variables sont toujours écrites, même en repli : la vitrine ne
 *     dépend plus des valeurs par défaut inscrites dans
 *     `tailwind.config.ts` (`var(--brand-primary, #0f172a)`), qui
 *     imposaient un bleu ardoise identique à tout le monde.
 *
 *  3. Deux variables DÉRIVÉES sont ajoutées, `--brand-soft` et
 *     `--brand-contrast`, calculées en CSS via `color-mix()` plutôt qu'en
 *     JavaScript. Raison : le commerçant choisit une seule couleur dans
 *     un `<input type="color">`, mais une vitrine crédible a besoin d'au
 *     moins un fond teinté clair (bandeaux, pastilles, survols) et d'une
 *     variante foncée (survol de bouton). Les calculer ici évite de
 *     demander trois couleurs au commerçant ou de coder en dur un gris
 *     qui jurerait avec la moitié des palettes.
 */
export interface TenantBrandingInput {
  brandColorPrimary: string | null;
  brandColorSecondary: string | null;
}

export interface TenantBrandingOptions {
  /** Palette du secteur, utilisée quand le commerçant n'a rien choisi. Voir storefront-blueprint.ts. */
  fallbackAccent?: { primary: string; secondary: string };
  /** Rayon des coins, exposé en variable pour que `rounded-brand` suive l'ambiance visuelle choisie. */
  radius?: string;
}

const PLATFORM_FALLBACK = { primary: "#0f172a", secondary: "#10b981" };

export function getTenantBrandingStyle(
  input: TenantBrandingInput,
  options: TenantBrandingOptions = {},
): CSSProperties {
  const fallback = options.fallbackAccent ?? PLATFORM_FALLBACK;
  const primary = input.brandColorPrimary || fallback.primary;
  const secondary = input.brandColorSecondary || fallback.secondary;

  const vars: Record<string, string> = {
    "--brand-primary": primary,
    "--brand-secondary": secondary,
    // `color-mix` est supporté par toutes les versions de Safari/Chrome/
    // Firefox sorties depuis 2023. Sur un navigateur plus ancien, la
    // déclaration est ignorée et la variable reste indéfinie : les règles
    // qui l'utilisent ont donc toutes un repli explicite dans
    // globals.css, jamais un fond transparent.
    "--brand-soft": `color-mix(in srgb, ${primary} 10%, white)`,
    "--brand-soft-strong": `color-mix(in srgb, ${primary} 18%, white)`,
    "--brand-dark": `color-mix(in srgb, ${primary} 82%, black)`,
    "--brand-border": `color-mix(in srgb, ${primary} 24%, white)`,
  };

  if (options.radius) vars["--brand-radius"] = options.radius;

  // Cast nécessaire : les custom properties (`--xxx`) ne font pas partie
  // du type `CSSProperties` de React, qui les applique pourtant
  // correctement au DOM.
  return vars as CSSProperties;
}

/**
 * Police choisie -> classes `next/font` à appliquer sur le même ancêtre
 * DOM que `getTenantBrandingStyle`. `null`/valeur inconnue retombent sur
 * « modern ».
 */
export function resolveTenantFontClassName(fontChoice: FontChoice | string | null | undefined): string {
  if (fontChoice && fontChoice in TENANT_FONT_VARIABLES) {
    return TENANT_FONT_VARIABLES[fontChoice as FontChoice];
  }
  return TENANT_FONT_VARIABLES.modern;
}

/** Rayon associé à l'ambiance visuelle — « impactante » assume des angles plus marqués, « douce » des coins très arrondis. */
export function resolveBrandRadius(visualStyle: "soft" | "clean" | "bold"): string {
  switch (visualStyle) {
    case "bold":
      return "0.25rem";
    case "clean":
      return "0.5rem";
    case "soft":
    default:
      return "0.875rem";
  }
}
