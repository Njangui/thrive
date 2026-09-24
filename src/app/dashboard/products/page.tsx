import Link from "next/link";
import { requireCurrentOrganization } from "@/application/services/auth-service";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { resolvePrimaryImageUrl } from "@/application/services/catalog-service";
import { listCategories } from "@/application/services/catalog-service";
import { CsvImportForm } from "./csv-import-form";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "En stock",
  out_of_stock: "Rupture",
  inactive: "Inactif",
};

const PAGE_SIZE = 12;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; page?: string; q?: string; status?: string; category?: string }>;
}) {
  const { success, page: pageParam, q: qParam, status: statusParam, category: categoryParam } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const q = (qParam ?? "").trim();
  const status = ["active", "draft", "out_of_stock", "inactive"].includes(statusParam ?? "") ? statusParam : "";
  const category = categoryParam ?? "";
  const page = Math.max(1, Number(pageParam) || 1);

  const supabase = getSupabaseServiceClient();
  const [categories, counts] = await Promise.all([
    listCategories(organizationId),
    Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "active").gt("current_stock", 0),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "out_of_stock"),
    ]),
  ]);

  let query = supabase
    .from("products")
    .select("id, name, sku, unit_price, current_stock, status, category_id, categories(name), product_images(url, position)", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (q) query = query.ilike("name", `%${q}%`);
  if (status) query = query.eq("status", status);
  if (category) query = query.eq("category_id", category);

  const from = (page - 1) * PAGE_SIZE;
  const { data: products, count } = await query.range(from, from + PAGE_SIZE - 1);
  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const total = counts[0].count ?? 0;
  const active = counts[1].count ?? 0;
  const out = counts[2].count ?? 0;
  const items = products ?? [];

  const pageUrl = (nextPage: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    if (nextPage > 1) params.set("page", String(nextPage));
    const value = params.toString();
    return `/dashboard/products${value ? `?${value}` : ""}`;
  };

  return (
    <div className="tokoo -page flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="tokoo -eyebrow">Catalogue</p>
          <h1 className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Mes produits</h1>
          <p className="mt-1 text-sm text-slate-500">Gérez votre catalogue de produits et de services.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/products/categories" className="adm-btn-secondary">Catégories</Link>
          <Link href="/dashboard/products/new" className="adm-btn-primary">+ Ajouter un produit</Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Total produits", total, "Produits enregistrés", "bg-primary-50 text-primary-700"],
          ["Produits en stock", active, "Actifs et visibles", "bg-info-50 text-info-700"],
          ["Produits en rupture", out, "À réapprovisionner", "bg-danger-50 text-danger-700"],
          ["Catégories", categories.length, "Organisation du catalogue", "bg-warning-50 text-warning-700"],
        ].map(([label, value, help, tone]) => (
          <div key={String(label)} className="adm-kpi flex items-start justify-between gap-3">
            <div>
              <p className="adm-label">{label}</p>
              <p className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight text-navy-900">{value}</p>
              <p className="mt-1 text-[11px] text-slate-400">{help}</p>
            </div>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold ${tone}`}>●</span>
          </div>
        ))}
      </section>

      {success && <p className="adm-alert-success">{success}</p>}

      <div className="adm-card overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center">
          <form method="get" className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <input name="q" defaultValue={q} placeholder="Rechercher un produit..." className="adm-input w-full pl-3" />
            </div>
            <select name="category" defaultValue={category} className="adm-input min-w-[170px]">
              <option value="">Toutes les catégories</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
            <select name="status" defaultValue={status} className="adm-input min-w-[150px]">
              <option value="">Tous les statuts</option>
              <option value="active">En stock</option>
              <option value="out_of_stock">Rupture</option>
              <option value="draft">Brouillon</option>
              <option value="inactive">Inactif</option>
            </select>
            <button type="submit" className="adm-btn-secondary">Filtrer</button>
            {(q || status || category) && <Link href="/dashboard/products" className="adm-btn-secondary">Réinitialiser</Link>}
          </form>
          <div className="hidden shrink-0 text-xs text-slate-400 sm:block">{totalCount} résultat{totalCount > 1 ? "s" : ""}</div>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((p) => {
            const imageUrl = resolvePrimaryImageUrl((p as unknown as { product_images?: { url: string; position: number }[] }).product_images);
            const categoryName = (p as unknown as { categories?: { name?: string } }).categories?.name ?? "Sans catégorie";
            const stock = Number(p.current_stock ?? 0);
            const isActive = p.status === "active" && stock > 0;
            return (
              <article key={p.id} className="tokoo -product-card group">
                <div className="relative aspect-square overflow-hidden bg-slate-100">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <div className="grid h-full place-items-center text-xs font-semibold text-slate-400">Aucune image</div>
                  )}
                  <span className={`absolute left-2.5 top-2.5 ${isActive ? "adm-badge-success" : p.status === "out_of_stock" || stock <= 0 ? "adm-badge-danger" : "adm-badge-neutral"}`}>
                    {STATUS_LABELS[p.status] ?? p.status}
                  </span>
                </div>
                <div className="p-3.5">
                  <p className="truncate text-sm font-bold text-navy-900">{p.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-slate-400">{categoryName}</p>
                  <p className="mt-2 font-jakarta text-sm font-extrabold text-navy-900">{Number(p.unit_price).toLocaleString("fr-FR")} FCFA</p>
                  <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[10px] text-slate-400">
                    <span>Stock : {stock}</span>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${isActive ? "bg-primary" : "bg-slate-300"}`} />
                      <Link href={`/dashboard/products/${p.id}/edit`} className="font-semibold text-slate-600 hover:text-primary">Modifier</Link>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {items.length === 0 && (
          <div className="tokoo -empty mx-4 mb-4">
            <div className="tokoo -empty-icon">＋</div>
            <h3 className="mt-3 font-jakarta text-base font-bold">Aucun produit trouvé</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">Modifiez vos filtres ou ajoutez votre premier produit au catalogue.</p>
            <Link href="/dashboard/products/new" className="adm-btn-primary mt-4">Ajouter un produit</Link>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>Page {page} sur {totalPages}</span>
          <div className="flex gap-2">
            {page > 1 && <Link href={pageUrl(page - 1)} className="adm-btn-secondary">←</Link>}
            {page < totalPages && <Link href={pageUrl(page + 1)} className="adm-btn-secondary">→</Link>}
          </div>
        </div>
      </div>

      <CsvImportForm organizationId={organizationId} />
    </div>
  );
}
