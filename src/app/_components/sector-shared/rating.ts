/**
 * Note moyenne à partir des avis RÉELS — partagé entre tous les templates
 * sectoriels qui affichent des témoignages notés.
 */

/** Note moyenne des avis qui portent une note. `null` si aucun — jamais de "5/5" par défaut. */
export function averageRating(testimonials: { rating: number | null }[]): { average: number; count: number } | null {
  const rated = testimonials.map((t) => t.rating).filter((r): r is number => typeof r === "number" && r > 0);
  if (rated.length === 0) return null;
  return { average: rated.reduce((sum, r) => sum + r, 0) / rated.length, count: rated.length };
}

export function formatAverage(average: number): string {
  return average.toFixed(1).replace(".", ",");
}
