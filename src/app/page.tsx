import type { Metadata } from "next";
import { getSupabaseServerSessionClient } from "@/infrastructure/supabase/server-session-client";
import {
  resolveRequestTenant,
  resolveCanonicalOrigin,
  resolveMarketingOrigin,
} from "@/infrastructure/tenant/resolve-request-tenant";
import {
  resolveOrganizationSeo,
  buildOrganizationJsonLd,
  buildSocialMetadata,
  buildWebSiteJsonLd,
  buildPlatformOrganizationJsonLd,
} from "@/lib/seo";
import { JsonLd } from "./_components/json-ld";
import { buildMarketingMetadata, PLATFORM_NAME } from "./_lib/marketing-page";
import { getStorefrontSite } from "@/application/services/storefront-service";
import { StorefrontShell } from "./_components/storefront/storefront-shell";
import { TenantLanding } from "./_components/tenant-landing";
import { MarketingLanding } from "./_components/marketing-landing";

/**
 * Favicon PAR TENANT pour la vitrine publique (cahier Lot E, Partie 1) —
 * distinct du manifest PWA global de l'app dashboard (Partie 3), qui lui
 * reste neutre. `icons` ici surcharge celui du root layout uniquement pour
 * les requêtes qui atteignent cette route (donc uniquement sur le domaine
 * du tenant, jamais sur le domaine racine de la plateforme).
 *
 * Lot H, Partie 1 — title/description/Open Graph/Twitter Card générés via
 * `src/lib/seo.ts::resolveOrganizationSeo` : jamais de balise vide
 * (critère d'acceptation Lot H), repli sur le nom de l'entreprise si aucun
 * champ SEO n'est renseigné. `alternates.canonical` utilise l'origine
 * OFFICIELLE du tenant (`resolveCanonicalOrigin` : son domaine custom
 * principal s'il en a un, sinon l'hôte visité), pas `NEXT_PUBLIC_APP_URL`
 * (qui pointerait vers le domaine générique de la plateforme).
 *
 * Audit SEO (sept. 2026) : la branche « sans tenant » (landing marketing)
 * n'avait ni canonique, ni image de partage, et n'était pas `noindex` sur
 * un hôte non reconnu — elle passe désormais par `buildMarketingMetadata`.
 */
const MARKETING_TITLE = "tokoo  — Gérez votre entreprise depuis un seul endroit";
const MARKETING_DESCRIPTION =
  "Catalogue, WhatsApp, réseaux sociaux, clients et finances connectés. tokoo  aide les commerçants et prestataires à organiser leur activité, sans compétences techniques.";

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveRequestTenant();

  // Lot 2 — sans tenant résolu, cette route sert la landing marketing de
  // tokoo  lui-même (avant ce lot : aucune métadonnée du tout, `{}`).
  if (!tenant) {
    return buildMarketingMetadata({
      path: "/",
      title: MARKETING_TITLE,
      description: MARKETING_DESCRIPTION,
    });
  }

  const origin = await resolveCanonicalOrigin();
  const seo = resolveOrganizationSeo(tenant);

  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: origin },
    ...buildSocialMetadata({
      title: seo.title,
      description: seo.description,
      url: origin,
      imageUrl: seo.ogImageUrl,
      imageIsSquare: seo.ogImageIsSquare,
      siteName: tenant.name,
    }),
    icons: tenant.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default async function RootPage({
  searchParams,
}: {
  // Lot K : feedback de la demande de rendez-vous publique (voir
  // landing-sections/booking-actions.ts) — mêmes noms de paramètres que
  // le pattern success/error déjà utilisé ailleurs (dashboard/site,
  // dashboard/appointments), préfixés "booking" pour ne jamais entrer en
  // collision avec un futur paramètre de la landing publique.
  // Country Engine : `waitlist_success`/`waitlist_error` alimentent la
  // section "Disponible en Afrique" (country-waitlist-actions.ts).
  searchParams: Promise<{
    bookingSuccess?: string;
    bookingError?: string;
    waitlist_success?: string;
    waitlist_error?: string;
  }>;
}) {
  const tenant = await resolveRequestTenant();

  if (!tenant) {
    const { waitlist_success, waitlist_error } = await searchParams;
    // Lien "Tableau de bord" dans le header/CTA de la landing plutôt que
    // Connexion/Inscription pour un visiteur déjà connecté (cookies de
    // session présents) — évite de redemander un login à chaque retour
    // sur la vitrine publique de tokoo . Simple lecture de session, PAS
    // de résolution d'organisation ici (`/dashboard` s'en charge déjà,
    // avec son propre repli vers `/onboarding` — voir sa note ; pas de
    // raison de dupliquer cette logique sur une page publique).
    const supabase = await getSupabaseServerSessionClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const marketingOrigin = resolveMarketingOrigin();
    return (
      <>
        {/* Entité « tokoo  » + nom du site : ce que Google lit pour afficher
            le nom de la marque (et non le domaine brut) dans les résultats. */}
        <JsonLd
          data={buildPlatformOrganizationJsonLd({
            name: PLATFORM_NAME,
            url: marketingOrigin,
            logoUrl: `${marketingOrigin}/images/tokoo -mark-512.png`,
            description: MARKETING_DESCRIPTION,
          })}
        />
        <JsonLd data={buildWebSiteJsonLd({ name: PLATFORM_NAME, url: marketingOrigin })} />
        <MarketingLanding
          waitlistFeedback={{ success: waitlist_success, error: waitlist_error }}
          isAuthenticated={Boolean(user)}
        />
      </>
    );
  }

  const { bookingSuccess, bookingError } = await searchParams;

  // La page vue est comptée par <StorefrontPageTracker /> (navigateur) — voir
  // landing-analytics-service.ts. Ne pas la recompter ici côté serveur.

  const origin = await resolveCanonicalOrigin();

  // JSON-LD (schema.org) — au-delà du strict minimum du cahier Lot H, mais
  // rien dans son "Hors scope" ne l'exclut (voir src/lib/seo.ts). Aide au
  // référencement local (rich snippets Google) pour des PME qui n'ont
  // souvent aucune autre présence structurée en ligne.
  const jsonLd = buildOrganizationJsonLd({
    name: tenant.name,
    description: tenant.description,
    url: origin,
    logoUrl: tenant.logoUrl,
    telephone: tenant.phone,
    email: tenant.email,
    address: tenant.address,
    openingHours: tenant.openingHours,
    socialLinks: tenant.socialLinks,
  });

  // Modèle de site complet (secteur, capacités réelles, navigation,
  // promesses, chiffres) — partagé avec l'enveloppe et toutes les autres
  // pages de la vitrine, et mémoïsé par requête.
  const site = await getStorefrontSite(tenant);

  return (
    <>
      <JsonLd data={jsonLd} />
      <JsonLd data={buildWebSiteJsonLd({ name: tenant.name, url: origin })} />
      <StorefrontShell site={site} home>
        <TenantLanding site={site} bookingFeedback={{ success: bookingSuccess, error: bookingError }} />
      </StorefrontShell>
    </>
  );
}
