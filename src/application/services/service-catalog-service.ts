import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

/**
 * Lot 3 (audit master prompt §17) — la table `services` existe depuis
 * 0008_catalog_faq_business.sql (RLS déjà en place, "members can access
 * services of their org" for all). Ce fichier ne porte plus QUE la
 * lecture pour le router IA (recherche par nom, message de découverte
 * WhatsApp) — voir conversation-orchestrator.ts.
 *
 * CORRECTIF (chantier catalogue V2, 0056) : ce fichier portait jusqu'ici
 * AUSSI `createService`/`updateService`/`deleteService`, un second chemin
 * d'écriture complet vers `services`, indépendant et incompatible de
 * `service-service.ts` (Lot 2) — les deux existaient en parallèle depuis
 * la fusion des lots 2 et 3, jamais réconciliés. Concrètement :
 * `/dashboard/services` (page principale) écrivait via CE fichier
 * (`priceFcfa`, suppression DÉFINITIVE), tandis que `/dashboard/services/
 * new` et `/dashboard/services/[id]/edit` — seuls écrans à exposer la
 * galerie photo et les informations complémentaires ajoutées par ce même
 * chantier — écrivaient via `service-service.ts` (`price`, jamais de
 * suppression dure, même convention que les produits). Un commerçant
 * créant une prestation depuis la page principale n'avait donc AUCUN
 * moyen d'atteindre la galerie qu'il venait de configurer nulle part
 * ailleurs, et pouvait supprimer définitivement une prestation dont le
 * lien était déjà partagé sur WhatsApp — contraire à la règle "jamais de
 * suppression dure d'une entrée de catalogue" tenue partout ailleurs
 * (voir l'en-tête de service-service.ts et de catalog-service.ts).
 * `/dashboard/services/page.tsx` a été repointé sur `service-service.ts`
 * (seul chemin d'écriture désormais) ; `listServices`/`createService`/
 * `updateService`/`deleteService`/`findOrCreateCategory` de CE fichier
 * sont donc retirés (plus aucun appelant) plutôt que laissés comme code
 * mort divergent.
 */

export interface ServiceSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryName: string | null;
  priceFcfa: number;
  durationMinutes: number | null;
  status: "draft" | "active" | "inactive" | "out_of_stock";
}

function mapServiceRow(row: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number;
  duration_minutes: number | null;
  status: string;
  categories?: { name?: string } | null;
}): ServiceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    categoryName: row.categories?.name ?? null,
    priceFcfa: Number(row.price),
    durationMinutes: row.duration_minutes,
    status: row.status as ServiceSummary["status"],
  };
}

/**
 * Recherche simple par nom (même discipline que
 * catalog-service.ts::searchProductsByName — ilike, pas de recherche
 * sémantique en V1, "règles avant IA"). Utilisée par le router IA pour
 * répondre aux questions sur une prestation sans jamais appeler l'IA.
 */
export async function searchServicesByName(organizationId: string, query: string, limit = 3): Promise<ServiceSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, slug, description, price, duration_minutes, status, categories(name)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .ilike("name", `%${query}%`)
    .limit(limit);

  if (error) throw new Error(`Erreur recherche prestations: ${error.message}`);
  return (data ?? []).map((r) => mapServiceRow(r as unknown as Parameters<typeof mapServiceRow>[0]));
}

/**
 * Lot P — prestations ACTIVES pour un PRODUCT_DISCOVERY (« présentez-moi
 * vos prestations », voir conversation-orchestrator.ts::presentCatalog).
 * Même discipline que catalog-service.ts::getActiveProducts : jamais un
 * statut autre que 'active'.
 */
export async function listActiveServices(organizationId: string, limit = 5): Promise<ServiceSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("services")
    .select("id, name, slug, description, price, duration_minutes, status, categories(name)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Erreur lecture prestations: ${error.message}`);
  return (data ?? []).map((r) => mapServiceRow(r as unknown as Parameters<typeof mapServiceRow>[0]));
}

/**
 * Réponse structurée pour le router IA (même forme que
 * catalog-service.ts::formatProductDiscoveryMessage) — jamais l'IA pour
 * une information déjà connue de façon fiable (section 26/29 du master
 * prompt).
 */
export function formatServiceDiscoveryMessage(services: ServiceSummary[]): string {
  if (services.length === 0) return "Nous n'avons pas encore de prestation correspondante à vous proposer.";

  return services
    .map((s) => {
      const parts = [
        s.name,
        `${s.priceFcfa.toLocaleString("fr-FR")} FCFA`,
        s.durationMinutes ? `${s.durationMinutes} min` : null,
        s.description ?? null,
      ].filter(Boolean);
      return `• ${parts.join(" — ")}`;
    })
    .join("\n");
}

/**
 * Lot P — présentation complète du catalogue de prestations (même rôle que
 * catalog-service.ts::formatProductDiscoveryMessage), avec en-tête et lien
 * vers la page /services — utilisée pour un PRODUCT_DISCOVERY, jamais pour
 * une recherche par nom (formatServiceDiscoveryMessage reste inchangée
 * pour ce cas, réponses plus courtes).
 */
export function formatServiceListMessage(services: ServiceSummary[], servicesUrl: string): string {
  if (services.length === 0) {
    return "Nous mettons actuellement nos prestations à jour — revenez très vite, ou dites-nous ce que vous cherchez !";
  }
  return [
    "👋 Bien sûr ! Voici quelques-unes de nos prestations :",
    "",
    formatServiceDiscoveryMessage(services),
    "",
    `Voir toutes nos prestations : ${servicesUrl}`,
  ].join("\n");
}
