/**
 * Horaires d'ouverture — logique PURE, sans React ni dépendance serveur.
 *
 * Partagée entre les templates sectoriels (restaurant, prestataire de
 * service, et les suivants) : un restaurant et un cabinet de conseil
 * affichent tous deux « aujourd'hui, ouvert de... à... » à partir des
 * mêmes sept créneaux hebdomadaires. Isolée du modèle de chaque page
 * pour une raison de poids : `use-today-index.ts` (composant client) en a
 * besoin, et importer tout un modèle de page (blueprint, routes, CTA…)
 * dans le bundle navigateur pour deux fonctions de tri serait un mauvais
 * calcul.
 */

export const DAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;
export type DayKey = (typeof DAYS)[number];

export interface HoursEntry {
  day: DayKey;
  label: string;
  hours: string;
}

/** Jours renseignés, dans l'ordre de la semaine. Les clés inconnues et les valeurs vides sont ignorées. */
export function getHoursEntries(openingHours: Record<string, string> | null | undefined): HoursEntry[] {
  const source = openingHours ?? {};
  return DAYS.flatMap((day) => {
    const hours = source[day]?.trim();
    return hours ? [{ day, label: day.charAt(0).toUpperCase() + day.slice(1), hours }] : [];
  });
}

/** Les sept jours ont la même plage : affichable sans connaître la date du visiteur. */
export function summarizeHours(entries: HoursEntry[]): string | null {
  if (entries.length !== DAYS.length) return null;
  const first = entries[0]!.hours;
  return entries.every((entry) => entry.hours === first) ? first : null;
}

/** Index du jour dans `DAYS` (0 = lundi) pour une date donnée — `Date#getDay` commence, lui, au dimanche. */
export function dayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}
