import type { CSSProperties } from "react";

/**
 * Thème de la landing boutique.
 *
 * Avant ce chantier, toutes les couleurs du template étaient écrites en dur
 * dans `globals.css` (`#171714`, `#d79a5c`…) : la couleur choisie par le
 * commerçant dans /dashboard/site n'avait donc AUCUN effet sur la page
 * d'accueil de sa boutique. Ici, on part de la palette réellement résolue
 * par `getStorefrontSite` (`site.accent` : couleur du commerçant, sinon
 * défaut du secteur) et on en tire des jetons CSS sûrs.
 *
 * « Sûrs » = lisibles. Une couleur de marque est libre (jaune vif, bleu
 * nuit, vert menthe…) alors qu'un bouton a besoin d'un texte contrasté :
 * le calcul de contraste (WCAG) se fait ici, une fois, côté serveur,
 * plutôt que de laisser chaque section deviner. Fonctions pures, testées
 * dans `retail-home.test.ts`.
 */

type Rgb = readonly [number, number, number];

/** Palette par défaut du secteur boutique — miroir de `RETAIL.defaultAccent` (storefront-blueprint.ts). */
const FALLBACK_BRAND: Rgb = [0x17, 0x17, 0x14];
const FALLBACK_ACCENT: Rgb = [0xd8, 0x9b, 0x5d];

const WHITE: Rgb = [255, 255, 255];
const INK: Rgb = [0x11, 0x11, 0x10];

/**
 * Contraste minimal du texte blanc sur les surfaces sombres (hero, vidéos,
 * clôture). 9:1 est nettement au-dessus du seuil AAA (7:1) : la surface
 * reste franchement sombre — donc lisible — même quand la couleur de
 * marque est vive.
 */
const DEEP_MIN_CONTRAST = 9;

export function parseHexColor(value: string | null | undefined): Rgb | null {
  if (!value) return null;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  const raw = match?.[1];
  if (!raw) return null;
  const hex = raw.length === 3 ? [...raw].map((char) => char + char).join("") : raw;
  const int = Number.parseInt(hex, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export function toHexColor(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;
}

function linearChannel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG 2.x (0 = noir, 1 = blanc). */
export function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Texte le plus lisible (blanc ou encre) posé sur `background`. */
export function readableTextOn(background: Rgb): string {
  return contrastRatio(background, WHITE) >= contrastRatio(background, INK) ? "#ffffff" : toHexColor(INK);
}

/**
 * Éclaircit `color` vers le blanc, par pas de 10 %, jusqu'à atteindre
 * `minRatio` contre `background`. Sert à garder l'accent lisible sur les
 * surfaces sombres même quand le commerçant a choisi un accent foncé.
 */
export function lightenForContrast(color: Rgb, background: Rgb, minRatio: number): Rgb {
  let current = color;
  for (let step = 1; step <= 10 && contrastRatio(current, background) < minRatio; step += 1) {
    const t = step / 10;
    // Arrondi à chaque pas : la couleur testée est EXACTEMENT celle qui sera écrite en hexadécimal.
    current = [
      Math.round(color[0] + (255 - color[0]) * t),
      Math.round(color[1] + (255 - color[1]) * t),
      Math.round(color[2] + (255 - color[2]) * t),
    ];
  }
  return current;
}

/**
 * Assombrit `color` vers le noir, par pas de 5 %, jusqu'à ce que le texte
 * `foreground` y atteigne `minRatio`. C'est ce qui donne à la landing des
 * surfaces sombres TEINTÉES de la couleur du commerçant (marine, vert
 * forêt, bordeaux…) plutôt qu'un noir identique pour toutes les boutiques.
 */
export function darkenForContrast(color: Rgb, foreground: Rgb, minRatio: number): Rgb {
  let current = color;
  for (let step = 1; step <= 20 && contrastRatio(current, foreground) < minRatio; step += 1) {
    const t = step / 20;
    current = [Math.round(color[0] * (1 - t)), Math.round(color[1] * (1 - t)), Math.round(color[2] * (1 - t))];
  }
  return current;
}

/**
 * Jetons dynamiques posés en `style` sur la racine `.rt-home`. Les jetons
 * statiques (espacements, rayon, échelle typographique) et les jetons
 * dérivés par `color-mix()` (encre, fond teinté, filets) vivent dans
 * `retail-home.css`.
 */
export function buildRetailThemeStyle(accent: { primary: string; secondary: string }): CSSProperties {
  const primary = parseHexColor(accent.primary) ?? FALLBACK_BRAND;
  const secondary = parseHexColor(accent.secondary) ?? FALLBACK_ACCENT;

  // Une teinte principale presque blanche donnerait des boutons pleins
  // invisibles sur fond clair : on retombe alors sur l'encre.
  const brand = relativeLuminance(primary) > 0.72 ? INK : primary;

  // Surface sombre : la couleur de marque, assombrie juste ce qu'il faut pour porter du texte blanc.
  const deep = darkenForContrast(brand, WHITE, DEEP_MIN_CONTRAST);

  const vars: Record<string, string> = {
    "--rt-brand": toHexColor(brand),
    "--rt-on-brand": readableTextOn(brand),
    "--rt-deep": toHexColor(deep),
    "--rt-accent": toHexColor(secondary),
    "--rt-on-accent": readableTextOn(secondary),
    // L'accent, quand il sert de TEXTE ou de filet sur la surface sombre (focus, liens) : éclairci jusqu'à 4,5:1 contre elle.
    "--rt-accent-on-dark": toHexColor(lightenForContrast(secondary, deep, 4.5)),
  };

  // Même cast que `getTenantBrandingStyle` : les custom properties ne font
  // pas partie du type `CSSProperties` de React mais sont bien appliquées au DOM.
  return vars as CSSProperties;
}
