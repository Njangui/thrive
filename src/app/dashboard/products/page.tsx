import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { resolvePrimaryImageUrl } from "@/application/services/catalog-service";
import { CsvImportForm } from "./csv-import-form";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Actif",
  out_of_stock: "Rupture",
  inactive: "Inactif",
};

// OPTIMISATION : cette page chargeait TOUT le catalogue en une requête,
// sans limite — correct tant qu'une boutique a une poignée de produits,
// mais le master prompt exige explicitement la pagination pour ce type
// d'écran (section 73), et le plan Starter autorise déjà jusqu'à 100
// produits (voir plan_entitlements). Pagination simple par page= dans
// l'URL, cohérente avec la limite déjà utilisée pour la liste des
// conversations (`listConversationsForOrg`, .limit(50)).
const PAGE_SIZE = 50;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; page?: string }>;
}) {
  const { success, page: pageParam } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = getSupabaseServiceClient();
  const {
    data: products,
    count,
  } = await supabase
    .from("products")
    .select("id, name, sku, unit_price, current_stock, status, categories(name), product_images(url, position)", {
      count: "exact",
    })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const items = products ?? [];
  const activeCount = items.filter((p) => p.status === "active").length;
  const outCount = items.filter((p) => Number(p.current_stock) <= 0).length;
  const draftCount = items.filter((p) => p.status === "draft").length;

  return (
    <div className="flex flex-col gap-6">
      <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white shadow-[0_20px_60px_-35px_rgba(14,17,48,.7)] sm:p-8">
        <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full bg-violet-500/25 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[.16em] text-violet-300">Vitrine · catalogue · ventes</p><h1 className="mt-2 font-jakarta text-3xl font-extrabold tracking-tight">Votre catalogue, au cœur de SME-OS.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Une seule fiche produit alimente votre site, votre suivi commercial et vos actions de communication.</p></div>
          <div className="flex flex-wrap gap-2"><Link href="/dashboard/products/categories" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/80 hover:bg-white/10">Catégories</Link><Link href="/dashboard/products/new" className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500">+ Ajouter</Link></div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-4">
        {[["Total", totalCount, "Produits enregistrés"],["Actifs", activeCount, "Visibles sur la vitrine"],["Ruptures", outCount, "À traiter en priorité"],["Brouillons", draftCount, "Pas encore publiés"]].map(([label,value,help]) => <div key={String(label)} className="adm-kpi"><p className="adm-label">{label}</p><p className="mt-1 adm-value">{value}</p><p className="mt-1 text-xs adm-muted">{help}</p></div>)}
      </section>

      {success && (
        <p className="adm-alert-success">{success}</p>
      )}

      <section className="adm-card bg-gradient-to-r from-violet-50 via-white to-white"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><p className="adm-eyebrow">Méthode recommandée</p><h2 className="mt-1 adm-heading-2 text-base">Créez des fiches simples mais complètes</h2><p className="mt-1 text-xs leading-5 text-slate-500">Photo · nom · prix · catégorie · stock · description. Une information manquante peut réduire la qualité de vos réponses et de votre vitrine.</p></div><span className="adm-badge-violet">Catalogue connecté</span></div></section>

      <CsvImportForm organizationId={organizationId} />

      <div className="adm-table-wrap">
        {(products ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun produit pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-navy-900/10 bg-[#FBFAFF] text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2" colSpan={2}>Produit</th>
                <th className="px-4 py-2">Catégorie</th>
                <th className="px-4 py-2">Prix</th>
                <th className="px-4 py-2">Stock</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p) => {
                const imageUrl = resolvePrimaryImageUrl(
                  (p as unknown as { product_images?: { url: string; position: number }[] }).product_images,
                );
                const categoryName = (p as unknown as { categories?: { name?: string } }).categories?.name ?? null;
                return (
                  <tr key={p.id} className="border-b border-navy-900/5 last:border-0">
                    <td className="py-2 pl-4">
                      {imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900/5 text-xs text-slate-400">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <p className="font-medium text-navy-900">{p.name}</p>
                      {p.sku && <p className="text-xs adm-muted">SKU : {p.sku}</p>}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{categoryName ?? "—"}</td>
                    <td className="px-4 py-2">{Number(p.unit_price).toLocaleString("fr-FR")}</td>
                    <td className="px-4 py-2">{p.current_stock}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          p.status === "active" ? "bg-success-50 text-success-700" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={`/dashboard/products/${p.id}/edit`} className="text-xs font-medium text-violet-600 hover:underline">
                        Modifier
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <p>
            Page {page} sur {totalPages} — {totalCount} produit{totalCount > 1 ? "s" : ""} au total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/products?page=${page - 1}`}
                className="rounded-xl border border-navy-900/10 px-3 py-1.5 font-medium hover:border-navy-900/20"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/products?page=${page + 1}`}
                className="rounded-xl border border-navy-900/10 px-3 py-1.5 font-medium hover:border-navy-900/20"
              >
                Suivant
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
