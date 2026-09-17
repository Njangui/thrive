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
    <div className="cresyva-page products-page flex min-w-0 flex-col gap-6">
      <header className="cresyva-page-hero">
        <div className="relative z-10 flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="cresyva-eyebrow">Vitrine · catalogue · ventes</p>
            <h1 className="mt-2 max-w-3xl font-jakarta text-3xl font-extrabold tracking-tight sm:text-4xl">Votre catalogue, au cœur de votre croissance.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Une seule fiche produit alimente votre site, vos conversations et vos actions commerciales.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/products/categories" className="cresyva-btn-ghost-dark">Catégories</Link>
            <Link href="/dashboard/products/new" className="cresyva-btn-primary">+ Ajouter un produit</Link>
          </div>
        </div>
      </header>

      <section className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Total produits", totalCount, "Produits enregistrés"],
          ["Produits actifs", activeCount, "Visibles sur votre vitrine"],
          ["Ruptures", outCount, "À traiter en priorité"],
          ["Brouillons", draftCount, "Pas encore publiés"],
        ].map(([label, value, help], index) => (
          <div key={String(label)} className={`cresyva-kpi ${index === 2 && Number(value) > 0 ? "cresyva-kpi-warning" : ""}`}>
            <p className="adm-label">{label}</p>
            <p className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight text-navy-900">{value}</p>
            <p className="mt-1 text-xs adm-muted">{help}</p>
          </div>
        ))}
      </section>

      {success && <p className="adm-alert-success">{success}</p>}

      <section className="cresyva-info-panel">
        <div>
          <p className="cresyva-eyebrow text-primary">Une fiche, plusieurs usages</p>
          <h2 className="mt-1 font-jakarta text-base font-bold">Créez des fiches simples mais complètes.</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Photo · nom · prix · catégorie · stock · description. Ces informations peuvent ensuite être réutilisées par votre site, votre CRM et vos canaux de communication.</p>
        </div>
        <span className="cresyva-status">Catalogue connecté</span>
      </section>

      <CsvImportForm organizationId={organizationId} />

      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-jakarta text-lg font-bold tracking-tight">Vos produits</h2>
            <p className="mt-1 text-xs text-slate-500">Gérez la visibilité, le stock et les informations de chaque fiche.</p>
          </div>
          <span className="hidden text-xs font-medium text-slate-400 sm:block">{totalCount} produit{totalCount > 1 ? "s" : ""}</span>
        </div>
        {items.length === 0 ? (
          <div className="cresyva-empty">
            <div className="cresyva-empty-icon">＋</div>
            <h3 className="font-jakarta text-base font-bold">Votre catalogue est encore vide</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">Ajoutez votre premier produit pour commencer à alimenter votre vitrine et vos conversations commerciales.</p>
            <Link href="/dashboard/products/new" className="adm-btn-primary mt-4">Ajouter mon premier produit</Link>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((p) => {
              const imageUrl = resolvePrimaryImageUrl((p as unknown as { product_images?: { url: string; position: number }[] }).product_images);
              const categoryName = (p as unknown as { categories?: { name?: string } }).categories?.name ?? null;
              const isActive = p.status === "active";
              const stock = Number(p.current_stock ?? 0);
              const isOut = stock <= 0;
              return (
                <article key={p.id} className="cresyva-product-card group">
                  <div className="relative aspect-[1.25/1] overflow-hidden bg-slate-100">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="grid h-full place-items-center text-sm font-medium text-slate-400">Aucune image</div>
                    )}
                    <span className={`absolute left-3 top-3 ${isActive ? "adm-badge-success" : "adm-badge-neutral"}`}>{STATUS_LABELS[p.status] ?? p.status}</span>
                    {isOut && <span className="absolute right-3 top-3 adm-badge-danger">Rupture</span>}
                  </div>
                  <div className="flex min-w-0 flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-jakarta text-sm font-bold text-navy-900">{p.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{categoryName ?? "Sans catégorie"}</p>
                      </div>
                      <Link href={`/dashboard/products/${p.id}/edit`} className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-primary hover:text-primary">Modifier</Link>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                      <div>
                        <p className="font-jakarta text-base font-extrabold text-navy-900">{Number(p.unit_price).toLocaleString("fr-FR")} FCFA</p>
                        <p className={`mt-1 text-xs font-medium ${isOut ? "text-danger-600" : "text-slate-500"}`}>Stock : {stock}</p>
                      </div>
                      {p.sku && <span className="max-w-[100px] truncate text-[10px] font-medium text-slate-400">SKU · {p.sku}</span>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>Page {page} sur {totalPages} — {totalCount} produit{totalCount > 1 ? "s" : ""} au total</p>
          <div className="flex gap-2">
            {page > 1 && <Link href={`/dashboard/products?page=${page - 1}`} className="adm-btn-secondary">Précédent</Link>}
            {page < totalPages && <Link href={`/dashboard/products?page=${page + 1}`} className="adm-btn-secondary">Suivant</Link>}
          </div>
        </div>
      )}
    </div>
  );
}
