import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { canUseFeature } from "@/application/services/entitlements-service";
import { getSiteDraft } from "@/application/services/site-version-service";
import { getStorefrontPreviewSite } from "@/application/services/storefront-service";
import { loadTenantContextByOrganizationId } from "@/infrastructure/tenant/resolve-request-tenant";
import { StorefrontShell } from "@/app/_components/storefront/storefront-shell";
import { TenantLanding } from "@/app/_components/tenant-landing";
import { BlockPage } from "@/app/_components/storefront/block-page";

/**
 * Aperçu PRIVÉ du brouillon du site (C4) : rend la vitrine avec le brouillon, avec les
 * vraies données du tenant, sans rien publier. Réservé aux membres connectés du tenant
 * (même garde que l'éditeur : `requireCurrentOrganization` + plan) ; jamais indexé.
 *
 * Les liens et boutons de l'aperçu sont volontairement inertes (ils mèneraient vers des
 * routes de vitrine qui n'existent pas sur le domaine du dashboard) : on change de page
 * avec la barre d'outils au-dessus.
 */
export const metadata: Metadata = { title: "Aperçu du brouillon", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const EDITOR = "/dashboard/site/versions";

export default async function SiteDraftPreviewPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page: pageSlug } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const customization = await canUseFeature(organizationId, "site_customization", 1);
  if (!customization.allowed) redirect(EDITOR);

  const [draft, tenant] = await Promise.all([getSiteDraft(organizationId), loadTenantContextByOrganizationId(organizationId)]);
  if (!draft) redirect(`${EDITOR}?error=${encodeURIComponent("Aucun brouillon à prévisualiser.")}`);
  if (!tenant) notFound();

  const pages = draft.snapshot.pages;
  const home = pages.find((p) => p.kind === "home");
  const target = pageSlug ? pages.find((p) => p.kind === "page" && p.slug === pageSlug) : home;
  if (!home || !target) notFound();

  const site = await getStorefrontPreviewSite(tenant, draft.snapshot);

  return (
    <div className="flex flex-col gap-3">
      <div className="adm-alert-warning flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <strong>Aperçu du brouillon (version {draft.versionNumber})</strong> — vos visiteurs ne voient rien de ceci tant que vous ne publiez pas. Les liens sont inactifs ici.
        </p>
        <Link href={EDITOR} className="adm-btn-secondary">← Retour à l&apos;éditeur</Link>
      </div>

      <nav aria-label="Pages du brouillon" className="flex flex-wrap gap-2">
        <Link href={`${EDITOR}/preview`} className={target.id === home.id ? "adm-btn-primary" : "adm-btn-secondary"}>Accueil</Link>
        {pages.filter((p) => p.kind === "page").map((p) => (
          <Link key={p.id} href={`${EDITOR}/preview?page=${encodeURIComponent(p.slug)}`} className={target.id === p.id ? "adm-btn-primary" : "adm-btn-secondary"}>
            {p.title}
          </Link>
        ))}
      </nav>

      <div className="overflow-hidden rounded-2xl border border-navy-900/10 [&_a]:pointer-events-none [&_button]:pointer-events-none">
        <StorefrontShell site={site} home={target.kind === "home"}>
          {target.kind === "home" && draft.snapshot.mode !== "free" ? <TenantLanding site={site} /> : <BlockPage site={site} page={target} isHome={target.kind === "home"} />}
        </StorefrontShell>
      </div>
    </div>
  );
}
