import type { MetadataRoute } from "next";
import { resolveRequestTenant, resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";

/**
 * robots.txt par tenant (Lot H, Partie 1 — complète l'implémentation SEO
 * au-delà du strict minimum demandé par le cahier ; rien dans son "Hors
 * scope" ne l'exclut). `x-tenant-slug`/`x-tenant-custom-domain` sont déjà
 * propagés pour cette route par `src/middleware.ts` (son matcher n'exclut
 * que `_next/static|_next/image|favicon.ico`), donc `resolveRequestTenant()`
 * fonctionne ici exactement comme dans page.tsx.
 *
 * Sans ce fichier, Next.js sert un robots.txt par défaut identique sur
 * tous les domaines (y compris le domaine racine interne de la
 * plateforme, qui ne doit jamais être indexé) et ne référence aucun
 * sitemap tenant-spécifique.
 */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await resolveRequestTenant();

  if (!tenant) {
    // Domaine racine plateforme / tenant suspendu : rien à indexer.
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  const origin = await resolveRequestOrigin();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Surfaces authentifiées/internes — jamais destinées à l'indexation,
      // quel que soit le tenant.
      disallow: ["/dashboard", "/admin", "/api", "/onboarding", "/login"],
    },
    sitemap: `${origin}/sitemap.xml`,
  };
}
