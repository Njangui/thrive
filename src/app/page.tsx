import type { Metadata } from "next";
import { resolveRequestTenant } from "@/infrastructure/tenant/resolve-request-tenant";
import { listActiveProductsForStorefront } from "@/application/services/catalog-service";
import { TenantLanding } from "./_components/tenant-landing";
import { InternalStatus } from "./_components/internal-status";

/**
 * Favicon PAR TENANT pour la vitrine publique (cahier Lot E, Partie 1) —
 * distinct du manifest PWA global de l'app dashboard (Partie 3), qui lui
 * reste neutre. `icons` ici surcharge celui du root layout uniquement pour
 * les requêtes qui atteignent cette route (donc uniquement sur le domaine
 * du tenant, jamais sur le domaine racine de la plateforme).
 */
export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveRequestTenant();
  if (!tenant?.faviconUrl) return {};
  return { icons: { icon: tenant.faviconUrl } };
}

export default async function RootPage() {
  const tenant = await resolveRequestTenant();

  if (!tenant) {
    return <InternalStatus />;
  }

  // OPTIMISATION : demande directement 6 produits à la requête SQL au lieu
  // de tout charger puis `.slice(0, 6)` en mémoire (voir le commentaire
  // sur listActiveProductsForStorefront).
  const products = await listActiveProductsForStorefront(tenant.organizationId, { limit: 6 });

  return <TenantLanding tenant={tenant} products={products} />;
}
