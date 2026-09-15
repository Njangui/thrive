/**
 * Ré-export : source déplacée vers `src/app/_components/app-charts.tsx`
 * (sept. 2026, chantier d'unification design) — ces graphiques ne sont
 * plus propres à la console Super Admin, le dashboard marchand les
 * utilise aussi. Fichier conservé ici comme alias pour ne casser aucun
 * `import { AdminLineChart, AdminDonutChart } from "./charts"` existant.
 */
export { AppLineChart as AdminLineChart, AppDonutChart as AdminDonutChart } from "@/app/_components/app-charts";
