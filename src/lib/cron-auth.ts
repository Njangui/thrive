/**
 * Lot 3 (audit master prompt §65, corrige un vrai trou de sécurité) :
 * les deux routes `/api/cron/*` existantes (process-broadcasts,
 * process-subscription-renewals) laissaient tourner le traitement SANS
 * authentification quand `CRON_SECRET` n'était pas configuré, quel que
 * soit `NODE_ENV` — juste un `console.warn`. En production sans secret
 * configuré (oubli de déploiement, pas un scénario exotique), n'importe
 * qui pouvait déclencher ces routes à volonté. §65 est explicite : "Si
 * NODE_ENV=production et CRON_SECRET est absent → comportement
 * fail-safe. Ne jamais laisser une route cron sensible accessible sans
 * authentification."
 *
 * Extrait en un seul helper (plutôt que dupliqué dans chaque route,
 * section 100) pour que toute future route `/api/cron/*` hérite
 * automatiquement de la même garde.
 */
import { env } from "./env";

export interface CronAuthResult {
  authorized: boolean;
  /** Statut HTTP à renvoyer si `authorized` est faux. */
  status: number;
  /** Corps JSON à renvoyer si `authorized` est faux. */
  body: { error: string };
}

export function verifyCronAuth(request: Request): CronAuthResult {
  if (env.CRON_SECRET) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return { authorized: false, status: 401, body: { error: "unauthorized" } };
    }
    return { authorized: true, status: 200, body: { error: "" } };
  }

  if (process.env.NODE_ENV === "production") {
    // Fail-safe explicite (§65) : jamais d'exécution non authentifiée en
    // production, même en l'absence de CRON_SECRET.
    console.error(
      "Route cron appelée en production sans CRON_SECRET configuré — requête refusée. " +
        "Configurez CRON_SECRET avant tout déploiement (voir docs/DEPLOYMENT.md).",
    );
    return { authorized: false, status: 503, body: { error: "cron_secret_not_configured" } };
  }

  // Hors production (dev/démo) sans CRON_SECRET : on laisse passer avec
  // un avertissement, pour ne pas bloquer un environnement de démo local.
  console.warn(
    "Route cron appelée sans CRON_SECRET configuré — route non protégée (hors production). " +
      "Configurez CRON_SECRET avant la mise en production (voir docs/DEPLOYMENT.md).",
  );
  return { authorized: true, status: 200, body: { error: "" } };
}
