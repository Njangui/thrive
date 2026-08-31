import { headers } from "next/headers";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

export interface TenantContext {
  organizationId: string;
  name: string;
  slug: string;
  industry: string | null;
  description: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  address: string | null;
  openingHours: Record<string, string>;
  socialLinks: Record<string, string>;
  logoUrl: string | null;
  bannerUrl: string | null;
  faviconUrl: string | null;
  currency: string;
}

interface RawOrganizationRow {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  description: string | null;
  phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  address: string | null;
  opening_hours: unknown;
  social_links: unknown;
  logo_url: string | null;
  banner_url: string | null;
  favicon_url: string | null;
  currency: string;
  status: string;
}

/**
 * Résout le tenant courant à partir des headers posés par le middleware
 * (`x-tenant-slug` pour tenant.sme-os.app, `x-tenant-custom-domain` pour un
 * domaine client). Utilisé UNIQUEMENT pour du contenu public (landing,
 * catalogue) — jamais pour des données sensibles, qui passent par
 * l'authentification + RLS normale (voir infrastructure/supabase).
 *
 * Retourne `null` si aucun tenant ne correspond (root domain = site
 * interne) ou si le tenant est suspendu/annulé.
 *
 * OPTIMISATION : la version précédente faisait TOUJOURS 2 aller-retours
 * DB séquentiels (résoudre l'id depuis le slug/domaine, PUIS relire la
 * ligne complète par id) — sur le chemin le plus fréquenté de toute
 * l'application (chaque page landing/catalogue publique, pas seulement
 * les pages authentifiées). Le cas `slug` n'a jamais eu besoin de deux
 * requêtes : on peut filtrer directement sur `organizations.slug`. Le cas
 * `customDomain` traverse réellement deux tables (`tenant_domains` puis
 * `organizations`), mais PostgREST sait le faire en un seul aller-retour
 * via une sélection imbriquée (`organizations(...)` depuis
 * `tenant_domains`) — le filtre de statut suspendu/annulé est vérifié en
 * mémoire après coup plutôt que dans la requête elle-même, pour ne pas
 * dépendre d'une syntaxe de filtre sur ressource imbriquée non testée
 * contre une vraie instance dans cet environnement.
 */
export async function resolveRequestTenant(): Promise<TenantContext | null> {
  const headerList = await headers();
  const slug = headerList.get("x-tenant-slug");
  const customDomain = headerList.get("x-tenant-custom-domain");

  if (!slug && !customDomain) return null;

  const supabase = getSupabaseServiceClient();
  const ORG_COLUMNS =
    "id, name, slug, industry, description, phone, whatsapp_number, email, address, opening_hours, social_links, logo_url, banner_url, favicon_url, currency, status";

  let org: RawOrganizationRow | null = null;

  if (slug) {
    const { data } = await supabase.from("organizations").select(ORG_COLUMNS).eq("slug", slug).maybeSingle();
    org = data;
  } else if (customDomain) {
    const { data } = await supabase
      .from("tenant_domains")
      .select(`organizations(${ORG_COLUMNS})`)
      .eq("domain", customDomain)
      .eq("verified", true)
      .maybeSingle();
    org = (data as unknown as { organizations: RawOrganizationRow | null } | null)?.organizations ?? null;
  }

  if (!org || org.status === "suspended" || org.status === "cancelled") return null;

  return {
    organizationId: org.id,
    name: org.name,
    slug: org.slug,
    industry: org.industry,
    description: org.description,
    phone: org.phone,
    whatsappNumber: org.whatsapp_number,
    email: org.email,
    address: org.address,
    openingHours: (org.opening_hours as Record<string, string>) ?? {},
    socialLinks: (org.social_links as Record<string, string>) ?? {},
    logoUrl: org.logo_url,
    bannerUrl: org.banner_url,
    faviconUrl: org.favicon_url,
    currency: org.currency,
  };
}

/** Construit un lien wa.me avec message pré-rempli (section 12 : CTA WhatsApp). */
export function buildWhatsAppLink(whatsappNumber: string, prefilledText: string): string {
  const digitsOnly = whatsappNumber.replace(/[^\d]/g, "");
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(prefilledText)}`;
}
