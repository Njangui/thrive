import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import type { CatalogProductSummary } from "./catalog-service";

/**
 * Formatte les derniers produits mentionnés dans la conversation pour
 * injection dans le contexte IA (Lot D, section 21/24 master prompt).
 * Volontairement borné et structuré (nom/prix/description uniquement) —
 * jamais un dump de l'historique des messages. Fonction pure, testée en
 * isolation (voir tenant-ai-context.test.ts), même pattern que
 * `formatProductDiscoveryMessage` dans catalog-service.ts.
 */
export function formatRecentProductsForAIContext(products: CatalogProductSummary[]): string {
  if (products.length === 0) return "";

  const lines = products.map((p) => {
    const price = `${p.unitPrice.toLocaleString("fr-FR")} FCFA`;
    return p.description ? `- ${p.name} — ${price} (${p.description})` : `- ${p.name} — ${price}`;
  });

  return [
    'Produits mentionnés juste avant dans cette conversation (pour comprendre une référence comme "celle à 25 000") :',
    ...lines,
  ].join("\n");
}

/**
 * Construit le system prompt envoyé au modèle pour un tenant donné.
 *
 * Règle absolue (section 9) : ne JAMAIS concaténer aveuglément toutes les
 * tables du tenant dans le prompt. Cette fonction sélectionne explicitement
 * quels champs sont pertinents et les assemble dans un format borné.
 * Quand un nouveau type d'information doit être injecté (FAQ, promotions...),
 * on l'ajoute ici explicitement — jamais via un `SELECT *` générique.
 *
 * `recentProducts` (Lot D) : derniers produits présentés au contact dans
 * la conversation courante, déjà résolus par
 * conversation-memory-service.ts — jamais l'historique complet.
 */
export async function buildTenantAIContext(
  organizationId: string,
  recentProducts: CatalogProductSummary[] = [],
): Promise<string> {
  const supabase = getSupabaseServiceClient();

  const [{ data: org }, { data: aiConfig }] = await Promise.all([
    supabase
      .from("organizations")
      .select("name, industry, timezone, currency, locale")
      .eq("id", organizationId)
      .single(),
    supabase
      .from("ai_config")
      .select("tone, language, objectives")
      .eq("organization_id", organizationId)
      .single(),
  ]);

  if (!org) {
    throw new Error(`Organization introuvable pour construire le contexte IA: ${organizationId}`);
  }

  const objectives = Array.isArray(aiConfig?.objectives) ? aiConfig.objectives : [];

  // TODO (Phase 8+) : injecter ici, de façon également explicite et bornée
  // (pas de SELECT *) : produits/services actifs, FAQ, horaires, politiques,
  // promotions en cours — dès que ces tables existeront (Phase 11+).
  return [
    `Tu es l'assistant conversationnel de "${org.name}"${org.industry ? ` (secteur : ${org.industry})` : ""}.`,
    `Réponds en ${aiConfig?.language ?? "fr"}, avec un ton ${aiConfig?.tone ?? "professionnel et chaleureux"}.`,
    objectives.length > 0 ? `Objectifs prioritaires : ${objectives.join(", ")}.` : "",
    formatRecentProductsForAIContext(recentProducts),
    `Si tu n'es pas certain d'une information (prix, disponibilité, politique spécifique), dis-le clairement plutôt que d'inventer une réponse, et propose un transfert humain.`,
  ]
    .filter(Boolean)
    .join("\n");
}
