import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError } from "@/lib/errors";

/**
 * Écran "Mon site" (Lot E, Partie 1 + Lot H, Partie 1). Portée à l'origine
 * limitée au logo/bannière/favicon — la personnalisation couleurs/polices
 * (section 13, `getTenantBrandingStyle`) n'existe TOUJOURS PAS dans ce
 * projet et relève encore d'un autre lot (Lot G/branding visuel), ce
 * service continue à ne pas y toucher.
 *
 * Lot H : les champs SEO de `organizations` (0022_seo_fields.sql) sont
 * ajoutés ICI plutôt que dans un nouveau `tenant-branding-service.ts` —
 * le cahier Lot H proposait les deux options ("nouveau fichier, ou étendre
 * un service équivalent existant si vérifié avant de créer"). Ce fichier
 * gère déjà exactement le même type de colonnes sur `organizations`
 * (logo/bannière/favicon), affichées sur la même page `/dashboard/site` —
 * dupliquer un second service pour 3 colonnes supplémentaires de la même
 * table, éditées depuis le même formulaire, aurait fragmenté la logique
 * sans bénéfice (DRY).
 */
export interface SiteMedia {
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgImageUrl: string | null;
}

export async function getSiteMedia(organizationId: string): Promise<SiteMedia> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("logo_url, banner_url, favicon_url, seo_title, seo_description, seo_og_image_url")
    .eq("id", organizationId)
    .maybeSingle();

  if (error) throw new Error(`Erreur lecture site pour ${organizationId}: ${error.message}`);
  if (!data) throw new NotFoundError("Entreprise introuvable");

  return {
    logoUrl: data.logo_url,
    bannerUrl: data.banner_url,
    faviconUrl: data.favicon_url,
    seoTitle: data.seo_title,
    seoDescription: data.seo_description,
    seoOgImageUrl: data.seo_og_image_url,
  };
}

export interface UpdateSiteMediaInput {
  logoUrl?: string;
  bannerUrl?: string;
  faviconUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoOgImageUrl?: string;
}

/**
 * Chaque champ n'est mis à jour que s'il a effectivement changé (voir
 * appelant) — un champ omis dans le payload laisse la colonne inchangée
 * plutôt que de l'écraser à null.
 */
export async function updateSiteMedia(organizationId: string, input: UpdateSiteMediaInput): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const payload: Record<string, string | null> = {};
  if (input.logoUrl !== undefined) payload.logo_url = input.logoUrl;
  if (input.bannerUrl !== undefined) payload.banner_url = input.bannerUrl;
  if (input.faviconUrl !== undefined) payload.favicon_url = input.faviconUrl;
  if (input.seoTitle !== undefined) payload.seo_title = input.seoTitle || null;
  if (input.seoDescription !== undefined) payload.seo_description = input.seoDescription || null;
  if (input.seoOgImageUrl !== undefined) payload.seo_og_image_url = input.seoOgImageUrl || null;

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("organizations").update(payload).eq("id", organizationId);
  if (error) throw new Error(`Impossible de mettre à jour le site de ${organizationId}: ${error.message}`);
}
