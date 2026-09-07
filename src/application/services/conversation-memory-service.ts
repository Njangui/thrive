import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getProductsByIds, type CatalogProductSummary } from "./catalog-service";

/**
 * Mémoire conversationnelle courte (Lot D, section 21/24 master prompt).
 *
 * Règle absolue : on ne mémorise QUE les derniers produits présentés dans
 * une conversation (3 max), jamais l'historique des messages — c'est ce
 * qui permet à l'IA de comprendre "celle à 25 000" après un
 * PRODUCT_DISCOVERY/PRODUCT_QUERY sans qu'on lui envoie tout l'échange.
 */
const MAX_REMEMBERED_PRODUCTS = 3;

/**
 * Enregistre les produits qui viennent d'être présentés au contact
 * (branches PRODUCT_DISCOVERY / PRODUCT_QUERY de l'orchestrateur).
 * Remplace la mémoire précédente plutôt que de la fusionner : c'est le
 * dernier lot de produits montré qui doit primer si le contact enchaîne
 * plusieurs recherches, pas un empilement d'anciennes mentions.
 *
 * Ne lève jamais — un échec d'écriture de la mémoire ne doit pas
 * empêcher l'envoi de la réponse au contact (même principe que
 * notification-service.ts : effet secondaire best-effort).
 */
export async function rememberMentionedProducts(
  organizationId: string,
  conversationId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;

  const trimmed = Array.from(new Set(productIds)).slice(0, MAX_REMEMBERED_PRODUCTS);

  try {
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("conversations")
      .update({ last_mentioned_product_ids: trimmed })
      .eq("id", conversationId)
      .eq("organization_id", organizationId);

    if (error) {
      console.warn(
        `[conversation-memory] échec mise à jour mémoire produits pour conversation ${conversationId}:`,
        error.message,
      );
    }
  } catch (err) {
    console.warn(
      `[conversation-memory] erreur inattendue rememberMentionedProducts (conversation ${conversationId}):`,
      err,
    );
  }
}

/**
 * Résout les derniers produits mentionnés dans une conversation (nom,
 * prix, description) — à injecter dans le contexte IA avant de tomber
 * en dernier recours sur l'IA (étape 6 du routeur). Retourne un tableau
 * vide en cas d'absence de mémoire ou d'erreur (jamais bloquant).
 */
export async function getRecentlyMentionedProducts(
  organizationId: string,
  conversationId: string,
): Promise<CatalogProductSummary[]> {
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("last_mentioned_product_ids")
      .eq("id", conversationId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) {
      console.warn(
        `[conversation-memory] échec lecture mémoire produits pour conversation ${conversationId}:`,
        error.message,
      );
      return [];
    }

    const productIds = data?.last_mentioned_product_ids ?? [];
    if (productIds.length === 0) return [];

    return await getProductsByIds(organizationId, productIds);
  } catch (err) {
    console.warn(
      `[conversation-memory] erreur inattendue getRecentlyMentionedProducts (conversation ${conversationId}):`,
      err,
    );
    return [];
  }
}
