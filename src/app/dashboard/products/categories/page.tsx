import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { listCategories, createCategory, renameCategory, deleteCategory } from "@/application/services/catalog-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";
import { DashTableCard, DashEmptyState } from "../../_components/ui";

/**
 * Gestion des catégories produit/service — page volontairement séparée du
 * formulaire de création (section : "les catégories doivent être
 * sélectionnées selon le secteur d'activité, pas retapées à chaque
 * produit"). Pré-remplie par secteur d'activité à la création de
 * l'entreprise (`seedDefaultCategories`) ; cette page permet d'ajuster la
 * liste quand le preset ne couvre pas exactement l'activité du
 * commerçant — une action explicite et rare, pas un champ texte réouvert
 * à chaque nouveau produit.
 */

async function createCategoryAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await createCategory(organizationId, String(formData.get("name") ?? ""));
  } catch (error) {
    const message = error instanceof AppError || error instanceof Error ? error.message : "Erreur lors de la création.";
    redirect(`/dashboard/products/categories?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/products/categories?success=" + encodeURIComponent("Catégorie ajoutée."));
}

async function renameCategoryAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await renameCategory(organizationId, categoryId, String(formData.get("name") ?? ""));
  } catch (error) {
    const message = error instanceof AppError || error instanceof Error ? error.message : "Erreur lors du renommage.";
    redirect(`/dashboard/products/categories?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/products/categories?success=" + encodeURIComponent("Catégorie renommée."));
}

async function deleteCategoryAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const categoryId = String(formData.get("categoryId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await deleteCategory(organizationId, categoryId);
  } catch (error) {
    const message = error instanceof AppError || error instanceof Error ? error.message : "Erreur lors de la suppression.";
    redirect(`/dashboard/products/categories?error=${encodeURIComponent(message)}`);
  }
  redirect(
    "/dashboard/products/categories?success=" +
      encodeURIComponent("Catégorie supprimée — les produits concernés ont simplement été décatégorisés."),
  );
}

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const categories = await listCategories(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="adm-heading-1">Catégories</h1>
          <p className="mt-1 text-sm adm-muted">
            Utilisées pour classer vos produits et services. <Link href="/dashboard/products" className="text-violet-600 hover:underline">← Retour au catalogue</Link>
          </p>
        </div>
      </div>

      {success && <p className="adm-alert-success">{success}</p>}
      {error && <p className="adm-alert-danger">{error}</p>}

      <DashTableCard title="Vos catégories">
        {categories.length === 0 ? (
          <DashEmptyState>Aucune catégorie pour l&apos;instant.</DashEmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-navy-900/5 px-5 pb-4">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3">
                <form action={renameCategoryAction} className="flex flex-1 items-center gap-2">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="categoryId" value={c.id} />
                  <input
                    name="name"
                    defaultValue={c.name}
                    className="w-full max-w-xs rounded-xl border border-navy-900/10 px-3 py-2 text-sm outline-hidden focus:border-violet-400"
                  />
                  <SubmitButton
                    pendingLabel="..."
                    className="rounded-xl border border-navy-900/10 px-3 py-2 text-xs font-medium text-navy-900 hover:border-navy-900/20 disabled:opacity-60"
                  >
                    Renommer
                  </SubmitButton>
                </form>
                <form action={deleteCategoryAction}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="categoryId" value={c.id} />
                  <SubmitButton
                    pendingLabel="..."
                    className="rounded-xl px-3 py-2 text-xs font-medium text-danger-600 hover:bg-danger-50 disabled:opacity-60"
                  >
                    Supprimer
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </DashTableCard>

      <DashTableCard title="Ajouter une catégorie">
        <form action={createCategoryAction} className="flex items-center gap-2 px-5 pb-5">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input
            name="name"
            required
            placeholder="Ex : Vêtements enfants"
            className="w-full max-w-xs rounded-xl border border-navy-900/10 px-3 py-2 text-sm outline-hidden focus:border-violet-400"
          />
          <SubmitButton pendingLabel="Ajout...">Ajouter</SubmitButton>
        </form>
      </DashTableCard>
    </div>
  );
}
