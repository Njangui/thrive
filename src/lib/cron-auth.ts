import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Section 65 du master prompt — "Les routes cron doivent être protégées
 * en production [...] Ne jamais laisser une route cron sensible
 * accessible sans authentification."
 *
 * Avant Lot 1, chaque route cron dupliquait la même vérification
 * (section 100/101 : une seule source de vérité par responsabilité) —
 * ET le comportement en l'absence de `CRON_SECRET` était le même quel
 * que soit l'environnement : un `console.warn`, puis l'exécution
 * continuait quand même. En production, une route cron qui décrémente
 * du stock, marque des paiements, ou déclenche des diffusions WhatsApp
 * ne doit JAMAIS rester accessible en clair simplement parce qu'une
 * variable d'env a été oubliée au déploiement — c'est le scénario que
 * ce helper ferme.
 *
 * Comportement :
 * - `CRON_SECRET` configuré -> vérifie `Authorization: Bearer <secret>`,
 *   refuse (401) si absent/incorrect, quel que soit l'environnement.
 * - `CRON_SECRET` absent EN PRODUCTION -> refuse (503) plutôt que
 *   d'exécuter sans protection. Fail-safe, pas un avertissement qu'on
 *   peut manquer dans les logs.
 * - `CRON_SECRET` absent HORS production (dev/démo) -> avertissement
 *   bruyant, mais l'exécution continue, pour ne pas bloquer un
 *   environnement de démo qui n'a pas encore configuré de secret.
 *
 * Utilisation dans une route cron :
 * ```ts
 * export async function POST(request: Request) {
 *   const authError = checkCronAuth(request, "/api/cron/ma-route");
 *   if (authError) return authError;
 *   // ... traitement ...
 * }
 * ```
 *
 * Retourne une `NextResponse` à renvoyer immédiatement si l'appel doit
 * être refusé, ou `null` si le traitement peut continuer.
 */
export function checkCronAuth(request: Request, routeName: string): NextResponse | null {
  if (env.CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      console.warn(`${routeName}: appel refusé (Authorization manquant ou incorrect).`);
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    console.error(
      `${routeName}: appelé en production sans CRON_SECRET configuré — requête refusée (fail-safe, section 65 du master prompt). Configurez CRON_SECRET avant tout déploiement de production.`,
    );
    return NextResponse.json({ error: "cron secret not configured" }, { status: 503 });
  }

  console.warn(
    `${routeName}: appelé sans CRON_SECRET configuré — route non protégée (environnement non-production, NODE_ENV=${process.env.NODE_ENV ?? "undefined"}). ` +
      "Configurez CRON_SECRET avant la mise en production, voir docs/DEPLOYMENT.md.",
  );
  return null;
}
