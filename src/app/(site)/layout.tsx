import type { ReactNode } from "react";
import { StorefrontShell } from "@/app/_components/storefront/storefront-shell";
import { requireStorefront } from "./_lib/storefront-page";

/**
 * Enveloppe de toutes les pages INTÉRIEURES du site vitrine (catalogue,
 * fiches, catégories, prestations, à propos, contact, rendez-vous, FAQ,
 * galerie).
 *
 * La page d'accueil (`src/app/page.tsx`) reste volontairement en dehors
 * de ce groupe de routes : elle est partagée avec le domaine racine de
 * tokoo , où elle rend la landing marketing et où un `notFound()` sur
 * absence de tenant serait faux. Elle applique donc `StorefrontShell`
 * elle-même, sur sa seule branche tenant.
 *
 * Le groupe `(site)` n'apparaît pas dans les URL : `/produits` reste
 * `/produits`, les liens déjà partagés continuent de fonctionner.
 */
export default async function StorefrontLayout({ children }: { children: ReactNode }) {
  const site = await requireStorefront();
  return <StorefrontShell site={site}>{children}</StorefrontShell>;
}
