import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError } from "@/lib/errors";

/**
 * Écran "Mon site" (Lot E, Partie 1) — scope volontairement limité au
 * logo/bannière/favicon. La personnalisation couleurs/polices/description
 * (section 13, `getTenantBrandingStyle`) n'existe pas encore dans ce
 * projet et relève d'un autre lot — ce service ne touche à aucune colonne
 * au-delà de celles nécessaires ici pour ne pas empiéter dessus.
 */
export interface SiteMedia {
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
}

export async function getSiteMedia(organizationId: string): Promise<SiteMedia> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("logo_url, banner_url, favicon_url")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture site pour ${organizationId}: ${error.message}`);
  if (!data) throw new NotFoundError("Entreprise introuvable");

  return { logoUrl: data.logo_url, bannerUrl: data.banner_url, faviconUrl: data.favicon_url };
}

export interface UpdateSiteMediaInput {
  logoUrl?: string;
  bannerUrl?: string;
  faviconUrl?: string;
}

/**
 * Chaque champ n'est mis à jour que s'il a effectivement changé (voir
 * appelant) — un champ omis dans le payload laisse la colonne inchangée
 * plutôt que de l'écraser à null.
 */
export async function updateSiteMedia(organizationId: string, input: UpdateSiteMediaInput): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const payload: Record<string, string> = {};
  if (input.logoUrl !== undefined) payload.logo_url = input.logoUrl;
  if (input.bannerUrl !== undefined) payload.banner_url = input.bannerUrl;
  if (input.faviconUrl !== undefined) payload.favicon_url = input.faviconUrl;

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("organizations").update(payload).eq("id", organizationId);
  if (error) throw new Error(`Impossible de mettre à jour le site de ${organizationId}: ${error.message}`);
}
