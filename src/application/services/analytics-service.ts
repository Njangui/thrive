import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Analytics de base (Lot H, Partie 2 — master prompt sections 55-56).
 *
 * Volontairement simple : compte des événements bruts par type, rien de
 * plus. Le master prompt est explicite (§55) : "le MVP doit rester
 * simple" — pas de funnels, pas de cohortes, pas d'A/B testing, pas de
 * dashboard graphique (docs/ROADMAP.md exclut déjà "Analytics avancées" du
 * V1, `08_LOT_H_analytics_seo_observabilite.md` le confirme explicitement
 * en "Hors scope"). `application/config/modules.ts` déclare déjà une clé
 * `analytics` (0008_catalog_faq_business.sql) mais aucun événement n'était
 * collecté avant ce lot — ce fichier ne fait QUE ça : collecter et compter.
 */

export const ANALYTICS_EVENT_TYPES = [
  "page_view",
  "product_view",
  "product_click",
  "cta_click",
  "lead_created",
  "conversation_started",
  "order_created",
  "publication_published",
] as const;

export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

function isAnalyticsEventType(value: string): value is AnalyticsEventType {
  return (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Enregistre un événement analytics. Fire-and-forget : ne lève JAMAIS,
 * même philosophie que `notifyOrgAdmins()` (notification-service.ts) et
 * `consumeCredit()` (ai-credits-service.ts) déjà dans le projet — un
 * événement analytics manqué (table pas encore migrée sur cet
 * environnement, coupure réseau ponctuelle...) ne doit JAMAIS faire
 * échouer l'action réelle qui l'a déclenché (rendu d'une page publique,
 * vente, création de lead...).
 *
 * Comme `notifyOrgAdmins`, les appelants côté serveur l'appellent avec
 * `await` (pas de `.catch()` nécessaire, elle ne rejette jamais) — cf.
 * lead-service.ts, order-service.ts, marketing-service.ts,
 * produits/[slug]/page.tsx, page.tsx. Un `await` ici garantit que
 * l'insertion a une chance de se terminer avant qu'une fonction serverless
 * ne rende sa réponse (contrairement à un vrai "fire-and-forget" non
 * awaité, qui peut être interrompu par la plateforme d'hébergement une
 * fois la réponse envoyée). Seul le petit composant client
 * `tracked-cta-link.tsx` (clic CTA, hors du cycle de vie d'une requête
 * serveur) l'appelle sans `await`, ce qui reste sûr car elle ne rejette
 * jamais.
 */
export async function trackEvent(
  organizationId: string,
  eventType: AnalyticsEventType,
  entityType?: string,
  entityId?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  if (!organizationId) return; // rien à tracker sans tenant résolu — jamais planter pour autant

  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("analytics_events").insert({
      organization_id: organizationId,
      event_type: eventType,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      metadata,
    });

    if (error) {
      console.warn(
        `[analytics] échec insertion événement "${eventType}" (org ${organizationId}):`,
        error.message,
      );
    }
  } catch (err) {
    console.warn(`[analytics] erreur inattendue trackEvent (org ${organizationId}, "${eventType}"):`, err);
  }
}

export type AnalyticsCounts = Record<AnalyticsEventType, number>;

export interface AnalyticsSummary {
  sinceDays: number;
  since: string;
  counts: AnalyticsCounts;
  totalEvents: number;
}

function zeroCounts(): AnalyticsCounts {
  return Object.fromEntries(ANALYTICS_EVENT_TYPES.map((type) => [type, 0])) as AnalyticsCounts;
}

/**
 * Agrégation par `event_type` sur une fenêtre glissante de `sinceDays`
 * jours. Réutilisable par le dashboard tenant (section "Activité (30j)")
 * ET, potentiellement, par une vue Super Admin — même logique qu'un
 * `GROUP BY event_type`, faite ici en JS pour rester cohérent avec le
 * reste du projet (le client Supabase JS n'exécute pas de vrai GROUP BY
 * sans fonction RPC dédiée, et créer une fonction SQL pour ce volume
 * serait une sur-ingénierie prématurée — même arbitrage que
 * `admin-organizations-service.ts::listOrganizationsForAdmin`).
 *
 * Ne lève JAMAIS (critère d'acceptation Lot H) : un tenant sans aucun
 * événement (table vide, ou tenant créé avant ce lot) reçoit un résultat
 * à zéro sur les 8 types connus, jamais une exception.
 */
export async function getAnalyticsSummary(organizationId: string, sinceDays = 30): Promise<AnalyticsSummary> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const counts = zeroCounts();

  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("analytics_events")
      .select("event_type")
      .eq("organization_id", organizationId)
      .gte("created_at", since);

    if (error) {
      console.warn(`[analytics] getAnalyticsSummary(${organizationId}) lecture échouée:`, error.message);
      return { sinceDays, since, counts, totalEvents: 0 };
    }

    for (const row of data ?? []) {
      const type = row.event_type as string;
      if (isAnalyticsEventType(type)) counts[type] += 1;
      // Un type inconnu (schéma futur en avance sur ce déploiement) est
      // ignoré silencieusement plutôt que de planter l'agrégation entière.
    }
  } catch (err) {
    console.warn(`[analytics] erreur inattendue getAnalyticsSummary(${organizationId}):`, err);
    return { sinceDays, since, counts: zeroCounts(), totalEvents: 0 };
  }

  const totalEvents = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return { sinceDays, since, counts, totalEvents };
}
