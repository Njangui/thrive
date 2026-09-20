import { cache } from "react";
import { headers } from "next/headers";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { env } from "@/lib/env";

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
  /** Lot H, Partie 1 — repli géré par src/lib/seo.ts::resolveOrganizationSeo, pas ici. */
  seoTitle: string | null;
  seoDescription: string | null;
  seoOgImageUrl: string | null;
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
  seo_title: string | null;
  seo_description: string | null;
  seo_og_image_url: string | null;
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
export const resolveRequestTenant = cache(async function resolveRequestTenant(): Promise<TenantContext | null> {
  const headerList = await headers();
  const slug = headerList.get("x-tenant-slug");
  const customDomain = headerList.get("x-tenant-custom-domain");

  if (!slug && !customDomain) return null;

  const supabase = getSupabaseServiceClient();
  const ORG_COLUMNS =
    "id, name, slug, industry, description, phone, whatsapp_number, email, address, opening_hours, social_links, logo_url, banner_url, favicon_url, currency, status, seo_title, seo_description, seo_og_image_url";

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
    seoTitle: org.seo_title,
    seoDescription: org.seo_description,
    seoOgImageUrl: org.seo_og_image_url,
  };
});

/**
 * Origine (protocole + host) de la requête courante — Lot H, Partie 1.
 * Sert à construire des URLs ABSOLUES correctes pour le tenant réellement
 * visité (canonical, Open Graph, JSON-LD, sitemap.xml) : contrairement à
 * `env.NEXT_PUBLIC_APP_URL` (déjà utilisé ailleurs dans le projet, ex.
 * marketing-service.ts, pour les liens WhatsApp), qui pointe vers le
 * domaine générique de la plateforme et ne reflète JAMAIS le sous-domaine
 * ni le domaine custom d'un tenant, ceci lit le header `host` déjà propagé
 * par `src/middleware.ts` pour CETTE requête précise — indispensable pour
 * qu'un sitemap.xml ou une URL canonique pointent vers le bon domaine.
 * `https` par défaut (tous les domaines tenant en production le sont),
 * `http` uniquement en local (hostname commençant par localhost/127.0.0.1).
 *
 * MÉMOÏSATION (vitrine V2) : `resolveRequestTenant` et
 * `resolveRequestOrigin` sont enveloppées dans `cache()` de React. Avec
 * une vitrine devenue multi-pages, chaque requête traverse désormais
 * `generateMetadata`, le layout du site ET la page elle-même — soit trois
 * résolutions de tenant identiques (donc trois requêtes Supabase) là où
 * une seule est nécessaire. `cache()` déduplique par requête HTTP, sans
 * jamais partager entre deux visiteurs ni entre deux tenants : la
 * mémoïsation est scopée au rendu en cours.
 */
export const resolveRequestOrigin = cache(async function resolveRequestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${host}`;
});

/**
 * Équivalent de `resolveRequestOrigin()` pour les contextes SANS requête
 * HTTP entrante d'un visiteur du tenant — cron (`process-telegram-publications`),
 * webhook entrant d'un provider tiers (Zernio/Telegram, dont le `host` est
 * celui de LA PLATEFORME qui reçoit le webhook, jamais celui du tenant),
 * job de campagne planifiée. `headers()`/`resolveRequestOrigin()` n'y sont
 * d'aucun secours : aucun visiteur n'est "sur" le domaine du tenant à ce
 * moment-là. Repart donc de la DB plutôt que de la requête courante.
 *
 * Même mise en garde que `resolveRequestOrigin` ci-dessus, pour les mêmes
 * raisons : `env.NEXT_PUBLIC_APP_URL` est le domaine générique de la
 * plateforme, jamais celui, réel, du tenant — corrigé le 19/09/2026 après
 * un lien produit partagé par un tenant sur son propre canal Telegram et
 * pointant, une fois cliqué, vers le domaine générique au lieu du sien
 * (404) ; voir `marketing-service.ts`, `omnichannel-publication-service.ts`,
 * `whatsapp-group-service.ts`, `conversation-orchestrator.ts`, seuls
 * autres endroits qui construisaient une URL publique tenant sans passer
 * par l'une ou l'autre de ces deux fonctions.
 *
 * Priorité : domaine custom VÉRIFIÉ marqué principal (`is_primary`), sinon
 * le premier domaine custom vérifié, sinon le sous-domaine plateforme
 * (`{slug}.NEXT_PUBLIC_ROOT_DOMAIN`, toujours disponible — mêmes règles
 * que `dashboard/site/page.tsx` pour l'aperçu du site). Ne lève jamais :
 * une organisation introuvable retombe sur `NEXT_PUBLIC_APP_URL` plutôt
 * que de faire échouer tout un envoi (le lien serait générique, mais
 * l'envoi/la publication elle-même doit quand même partir).
 */
export async function getTenantPublicOrigin(organizationId: string): Promise<string> {
  const supabase = getSupabaseServiceClient();

  const [{ data: customDomain }, { data: org }] = await Promise.all([
    supabase
      .from("tenant_domains")
      .select("domain")
      .eq("organization_id", organizationId)
      .eq("verified", true)
      .order("is_primary", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("organizations").select("slug").eq("id", organizationId).maybeSingle(),
  ]);

  if (customDomain?.domain) return `https://${customDomain.domain}`;
  if (org?.slug) return `https://${org.slug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`;

  console.warn(`getTenantPublicOrigin(${organizationId}): organisation introuvable, repli sur NEXT_PUBLIC_APP_URL.`);
  return env.NEXT_PUBLIC_APP_URL;
}

// `buildWhatsAppLink` vit désormais dans src/lib/whatsapp.ts (fonction
// pure, sans dépendance à next/headers ni à React `cache()`) — réexportée
// ici pour ne casser aucun des imports existants depuis ce fichier.
export { buildWhatsAppLink } from "@/lib/whatsapp";
