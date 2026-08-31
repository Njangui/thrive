import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
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
    .select("id, name, unit_price, current_stock, status", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .range(from, to);

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold tracking-tight">Catalogue</h1>
        <Link
          href="/dashboard/products/new"
          className="rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white"
        >
          + Ajouter un produit
        </Link>
      </div>

      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <CsvImportForm organizationId={organizationId} />

      <div className="overflow-hidden rounded-brand border border-ink/10 bg-white">
        {(products ?? []).length === 0 ? (
          <p className="p-6 text-sm text-muted">Aucun produit pour l&apos;instant.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Prix</th>
                <th className="px-4 py-2">Stock</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(products ?? []).map((p) => (
                <tr key={p.id} className="border-b border-ink/5 last:border-0">
                  <td className="px-4 py-2">{p.name}</td>
                  <td className="px-4 py-2">{Number(p.unit_price).toLocaleString("fr-FR")}</td>
                  <td className="px-4 py-2">{p.current_stock}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.status === "active" ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-muted"
                      }`}
                    >
                      {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Link href={`/dashboard/products/${p.id}/edit`} className="text-xs font-medium text-leaf hover:underline">
                      Modifier
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <p>
            Page {page} sur {totalPages} — {totalCount} produit{totalCount > 1 ? "s" : ""} au total
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/dashboard/products?page=${page - 1}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
              >
                Précédent
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/dashboard/products?page=${page + 1}`}
                className="rounded-brand border border-ink/15 px-3 py-1.5 font-medium hover:border-ink/30"
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
