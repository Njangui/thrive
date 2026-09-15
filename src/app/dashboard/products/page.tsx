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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-jakarta text-2xl font-bold tracking-tight">Catalogue</h1>
          <Link href="/dashboard/products/categories" className="text-xs font-medium text-violet-600 hover:underline">
            Gérer les catégories
          </Link>
        </div>
        <Link
          href="/dashboard/products/new"
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white"
        >
          + Ajouter un produit
        </Link>
      </div>

      {success && (
        <p className="adm-alert-success">{success}</p>
      )}

      <CsvImportForm organizationId={organizationId} />

      <div className="overflow-x-auto rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)]">
        {(products ?? []).length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucun produit pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-navy-900/10 text-left text-xs uppercase text-slate-500">
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
