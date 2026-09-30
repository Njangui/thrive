/**
 * Lisibilité de la couleur d'accent choisie par le commerçant.
 *
 * Le commerçant choisit librement sa couleur principale : un jaune ou un
 * orange clair est un choix courant (restaurants, artisans...). Un texte blanc sur
 * un bouton jaune (2:1) est illisible, comme un lien jaune sur fond blanc.
 * Ce module calcule, d'après la couleur réelle, la couleur de texte à poser
 * SUR l'accent et une version de l'accent assez sombre pour servir de texte
 * sur fond clair — au lieu de supposer que toute couleur de marque est
 * foncée.
 *
 * Calcul WCAG 2.x (luminance relative, rapport de contraste), sans
 * dépendance : quelques lignes valent mieux qu'une bibliothèque de couleurs
 * dans le bundle de la vitrine.
 *
 * Partagé entre tous les templates sectoriels : la lisibilité du texte posé
 * sur l'accent ne dépend que de la couleur choisie, jamais du secteur.
 */

export const INK = "#1b1f1c";
const INK_RGB: Rgb = [27, 31, 28];

type Rgb = [number, number, number];

export interface AccentTheme {
  /** Couleur du texte posé sur l'accent (boutons pleins, pastilles). */
  onAccent: string;
  /** Accent assouplissable en TEXTE sur fond clair : contraste ≥ 5,2:1 avec le blanc (≥ 4,5:1 sur les fonds teintés). */
  ink: string;
}

export function parseHex(hex: string | null | undefined): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!match) return null;
  const digits = match[1]!;
  const full = digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_ON_LIGHT_TARGET = 5.2;
/** Seuil WCAG AA pour du texte en corps normal (couleurs de boutons, pastilles). */
const TEXT_ON_ACCENT_TARGET = 4.5;

/**
 * `contrastRatio(a, 0)` et `contrastRatio(a, 1)` (noir et blanc purs) ne
 * tombent jamais tous les deux sous 4,5:1, quelle que soit la luminance `a` —
 * le pire des deux cas se situe autour de 4,58:1. Le blanc et l'encre de
 * marque (`INK`, légèrement plus claire que le noir pur) sont préférés pour
 * l'harmonie visuelle ; le noir pur ne sert que de filet de sécurité quand
 * aucun des deux n'atteint le seuil.
 */
function pickOnAccent(l: number): string {
  const contrastWhite = contrastRatio(1, l);
  const contrastInk = contrastRatio(l, luminance(INK_RGB));
  if (contrastWhite >= contrastInk) return contrastWhite >= TEXT_ON_ACCENT_TARGET ? "#ffffff" : "#000000";
  return contrastInk >= TEXT_ON_ACCENT_TARGET ? INK : "#000000";
}

/** `null` si la valeur n'est pas un code hexadécimal : la feuille de style retombe alors sur son calcul `color-mix`. */
export function resolveAccentTheme(hex: string | null | undefined): AccentTheme | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;

  const l = luminance(rgb);
  const onAccent = pickOnAccent(l);

  // Assombrit l'accent par petits pas (jamais au-delà de 90 % de noir) jusqu'à un contraste lisible.
  let darkening = 0.12;
  let ink: Rgb = mixWithBlack(rgb, darkening);
  while (contrastRatio(1, luminance(ink)) < TEXT_ON_LIGHT_TARGET && darkening < 0.9) {
    darkening += 0.04;
    ink = mixWithBlack(rgb, darkening);
  }
  return { onAccent, ink: toHex(ink) };
}

function mixWithBlack([r, g, b]: Rgb, amount: number): Rgb {
  return [r * (1 - amount), g * (1 - amount), b * (1 - amount)];
}
