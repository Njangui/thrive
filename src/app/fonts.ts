import { Space_Grotesk, Inter, Playfair_Display, Lora, Poppins, Nunito } from "next/font/google";
import type { FontChoice } from "@/domain/entities/landing";

/**
 * BUG CORRIGÉ ICI (chantier vitrine V2, sept. 2026) — ce fichier
 * n'exportait qu'une table de correspondance factice :
 *
 *   TENANT_FONT_VARIABLES = { modern: "--font-display --font-body", ... }
 *
 * Ces chaînes étaient passées telles quelles à `className` par
 * `resolveTenantFontClassName()` (src/lib/tenant-branding.ts), et
 * `src/app/layout.tsx` posait de son côté `className="--font-display
 * --font-body"` sur `<html>` à partir de deux objets factices
 * (`const displayFont = { variable: "--font-display" }`). Résultat :
 * `--font-display` / `--font-body` n'étaient JAMAIS définies nulle part,
 * donc `font-display` / `font-body` (tailwind.config.ts) retombaient sur
 * `sans-serif` — la vitrine publique de TOUS les tenants s'affichait en
 * police système, et les 3 choix de police du dashboard (« Moderne /
 * Classique / Chaleureux ») n'avaient strictement aucun effet visible.
 * C'est la première cause de l'écart de rendu constaté entre la maquette
 * et la vitrine réelle.
 *
 * Les 3 paires sont maintenant réellement chargées via `next/font/google`
 * (self-hosting automatique, aucun appel réseau vers Google au runtime —
 * important : le CSP posé dans next.config.mjs n'autorise pas
 * fonts.googleapis.com). Chaque appel produit une classe qui définit la
 * variable CSS correspondante : il suffit de poser la paire choisie sur
 * le conteneur racine de la vitrine pour que tout le sous-arbre en
 * hérite.
 *
 * `preload` n'est activé que sur la paire « modern » : c'est le défaut de
 * la plateforme (et le fallback de `resolveTenantFontClassName`), donc la
 * seule qui mérite un `<link rel="preload">` sur chaque page. Les deux
 * autres restent chargées à la demande — sinon 6 fontes seraient
 * préchargées sur chaque vitrine, dont 4 inutilisées.
 */

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
});

const interBody = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
  display: "swap",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
  preload: false,
});

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700"],
  display: "swap",
  preload: false,
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
  display: "swap",
  preload: false,
});

/**
 * Classes `next/font` à appliquer sur le conteneur racine de la vitrine
 * (voir src/lib/tenant-branding.ts::resolveTenantFontClassName). Le nom
 * historique de l'export est conservé : il est importé tel quel par
 * tenant-branding.ts, et le renommer n'aurait apporté aucun bénéfice
 * visible côté commerçant.
 */
export const TENANT_FONT_VARIABLES: Record<FontChoice, string> = {
  modern: `${spaceGrotesk.variable} ${interBody.variable}`,
  classic: `${playfair.variable} ${lora.variable}`,
  friendly: `${poppins.variable} ${nunito.variable}`,
};

/** Paire par défaut de la plateforme — posée sur `<html>` par le root layout. */
export const PLATFORM_FONT_VARIABLES = TENANT_FONT_VARIABLES.modern;

export const FONT_CHOICE_LABELS: Record<FontChoice, string> = {
  modern: "Moderne (Space Grotesk / Inter)",
  classic: "Classique (Playfair Display / Lora)",
  friendly: "Chaleureux (Poppins / Nunito)",
};

/**
 * Aperçu utilisé par le sélecteur de police du dashboard : permet
 * d'afficher chaque option DANS sa propre police plutôt qu'une liste de
 * noms en police uniforme.
 */
export const FONT_CHOICE_PREVIEW_CLASS: Record<FontChoice, string> = TENANT_FONT_VARIABLES;
