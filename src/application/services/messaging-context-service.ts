import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getStorefrontBlueprint, resolveStorefrontSector } from "@/application/config/storefront-blueprint";

/**
 * Lot P — ce que le routeur de messages doit savoir du TENANT pour parler
 * son langage : secteur (immobilier → « biens », restaurant → « plats »…),
 * message de catalogue vide, et quelles informations pratiques sont
 * renseignées (pour ne proposer dans l'accueil que ce qui existe vraiment).
 * Une seule lecture, jamais bloquante : en cas d'erreur, contexte neutre.
 */
export interface MessagingOrgContext {
  name: string | null;
  sector: string;
  itemLabelPlural: string;
  emptyCatalogMessage: string;
  hasHours: boolean;
  hasAddress: boolean;
  hasContact: boolean;
}

export const NEUTRAL_MESSAGING_CONTEXT: MessagingOrgContext = {
  name: null,
  sector: "",
  itemLabelPlural: "produits",
  emptyCatalogMessage: "Nous mettons actuellement notre catalogue à jour — revenez très vite, ou dites-nous ce que vous cherchez !",
  hasHours: false,
  hasAddress: false,
  hasContact: false,
};

export async function getMessagingOrgContext(organizationId: string): Promise<MessagingOrgContext> {
  try {
    const { data, error } = await getSupabaseServiceClient()
      .from("organizations")
      .select("name, industry, opening_hours, address, phone, whatsapp_number, email")
      .eq("id", organizationId)
      .maybeSingle();
    if (error || !data) return NEUTRAL_MESSAGING_CONTEXT;

    const sector = resolveStorefrontSector(data.industry as string | null);
    const blueprint = getStorefrontBlueprint(data.industry as string | null);
    const hours = data.opening_hours as Record<string, unknown> | null;
    return {
      name: (data.name as string | null) ?? null,
      sector,
      // Secteur inconnu : « produits » (le blueprint générique dit « articles »).
      itemLabelPlural: sector ? blueprint.catalogItemLabelPlural : NEUTRAL_MESSAGING_CONTEXT.itemLabelPlural,
      emptyCatalogMessage: sector ? blueprint.emptyCatalogMessage : NEUTRAL_MESSAGING_CONTEXT.emptyCatalogMessage,
      hasHours: Boolean(hours && Object.keys(hours).length > 0),
      hasAddress: Boolean((data.address as string | null)?.trim()),
      hasContact: Boolean(data.phone || data.whatsapp_number || data.email),
    };
  } catch (error) {
    console.warn(`getMessagingOrgContext(${organizationId}): contexte neutre utilisé.`, error);
    return NEUTRAL_MESSAGING_CONTEXT;
  }
}
