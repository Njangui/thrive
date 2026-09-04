import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError } from "@/lib/errors";

/**
 * Écran "Mon site" (Lot E, Partie 1 + Lot H, Partie 1 + Lot K). Portée à
 * l'origine limitée au logo/bannière/favicon.
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
 *
 * Lot K : `social_links` (`organizations.social_links`, colonne déjà lue
 * par `resolve-request-tenant.ts` mais jamais écrite nulle part avant ce
 * lot — vérifié) rejoint ce même service pour la même raison : c'est
 * encore une colonne `organizations` éditée depuis ce même écran
 * "Mon site". Les COULEURS/POLICE de marque, elles, ne vivent volontai-
 * rement PAS ici : ce sont des colonnes de `organization_landing_config`
 * (nouvelle table Lot K), gérées par `landing-config-service.ts` — cette
 * ligne de partage suit la même logique que le reste de ce fichier
 * (une table = un service), pas un choix arbitraire.
 */
export interface SiteMedia {
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgImageUrl: string | null;
  socialLinks: Record<string, string>;
}

export async function getSiteMedia(organizationId: string): Promise<SiteMedia> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("logo_url, banner_url, favicon_url, seo_title, seo_description, seo_og_image_url, social_links")
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
    socialLinks: (data.social_links as Record<string, string>) ?? {},
  };
}

export interface UpdateSiteMediaInput {
  logoUrl?: string;
  bannerUrl?: string;
  faviconUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoOgImageUrl?: string;
  socialLinks?: Record<string, string>;
}

/**
 * Chaque champ n'est mis à jour que s'il a effectivement changé (voir
 * appelant) — un champ omis dans le payload laisse la colonne inchangée
 * plutôt que de l'écraser à null.
 */
export async function updateSiteMedia(organizationId: string, input: UpdateSiteMediaInput): Promise<void> {
  const supabase = getSupabaseServiceClient();

  const payload: Record<string, string | null | Record<string, string>> = {};
  if (input.logoUrl !== undefined) payload.logo_url = input.logoUrl;
  if (input.bannerUrl !== undefined) payload.banner_url = input.bannerUrl;
  if (input.faviconUrl !== undefined) payload.favicon_url = input.faviconUrl;
  if (input.seoTitle !== undefined) payload.seo_title = input.seoTitle || null;
  if (input.seoDescription !== undefined) payload.seo_description = input.seoDescription || null;
  if (input.seoOgImageUrl !== undefined) payload.seo_og_image_url = input.seoOgImageUrl || null;
  if (input.socialLinks !== undefined) {
    // N'enregistre que les URLs non vides — un champ vidé par le
    // commerçant disparaît du JSON plutôt que d'y laisser une chaîne
    // vide (cohérent avec le repli déjà fait par
    // landing-sections/social-links.tsx à l'affichage).
    payload.social_links = Object.fromEntries(
      Object.entries(input.socialLinks).filter(([, url]) => url && url.trim().length > 0),
    );
  }

  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase.from("organizations").update(payload).eq("id", organizationId);
  if (error) throw new Error(`Impossible de mettre à jour le site de ${organizationId}: ${error.message}`);
}
