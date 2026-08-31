import type { Metadata } from "next";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { listActiveProductsForStorefront } from "@/application/services/catalog-service";
import { trackEvent } from "@/application/services/analytics-service";
import { resolveOrganizationSeo, buildOrganizationJsonLd } from "@/lib/seo";
import { TenantLanding } from "./_components/tenant-landing";
import { InternalStatus } from "./_components/internal-status";

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
 * RÉELLE de la requête (`resolveRequestOrigin`), pas `NEXT_PUBLIC_APP_URL`
 * (qui pointerait vers le domaine générique de la plateforme, jamais vers
 * le sous-domaine/domaine custom effectivement visité).
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const origin = await resolveRequestOrigin();
  const seo = resolveOrganizationSeo(tenant);

  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: origin },
    openGraph: {
      type: "website",
      title: seo.title,
      description: seo.description,
      url: origin,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
    twitter: {
      card: seo.ogImageUrl ? "summary_large_image" : "summary",
      title: seo.title,
      description: seo.description,
      images: seo.ogImageUrl ? [seo.ogImageUrl] : undefined,
    },
    icons: tenant.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default async function RootPage() {
  const tenant = await resolveRequestTenant();

  if (!tenant) {
    return <InternalStatus />;
  }

  // Lot H, Partie 2 (master prompt §55) — démarré en parallèle du reste,
  // `await`é avant de rendre pour donner à l'insertion une vraie chance de
  // se terminer avant que la réponse ne parte (même raisonnement que
  // `notifyOrgAdmins`, voir analytics-service.ts::trackEvent) sans pour
  // autant sérialiser sa latence avec le reste du chargement de la page.
  const trackPageView = trackEvent(tenant.organizationId, "page_view", "organization");

  const [products, origin] = await Promise.all([
    // OPTIMISATION (fusion précédente) : demande directement 6 produits à
    // la requête SQL au lieu de tout charger puis `.slice(0, 6)` en
    // mémoire (voir le commentaire sur listActiveProductsForStorefront).
    listActiveProductsForStorefront(tenant.organizationId, { limit: 6 }),
    resolveRequestOrigin(),
  ]);

  await trackPageView;

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
  });

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <TenantLanding tenant={tenant} products={products} />
    </>
  );
}
