import { redirect, notFound } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { updateProduct, getProductForEdit } from "@/application/services/catalog-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";

const STATUS_OPTIONS = [
  { value: "draft", label: "Brouillon" },
  { value: "active", label: "Actif" },
  { value: "out_of_stock", label: "Rupture" },
  { value: "inactive", label: "Inactif" },
];

async function updateProductAction(formData: FormData) {
  "use server";

  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const currentImageUrl = String(formData.get("currentImageUrl") ?? "") || undefined;

    const imageUrl = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "product",
      fileField: "imageFile",
      urlField: "imageUrl",
      currentUrl: currentImageUrl,
    });

    // Ne remonte à updateProduct que si l'image a réellement changé —
    // sinon on réinsérerait inutilement la même ligne product_images à
    // chaque édition (voir replacePrimaryProductImage dans catalog-service).
    const imageChanged = imageUrl && imageUrl !== currentImageUrl;

    await updateProduct(productId, organizationId, {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryName: String(formData.get("category") ?? "") || undefined,
      unitPrice: Number(formData.get("price") ?? 0),
      currentStock: Number(formData.get("stock") ?? 0),
      status: String(formData.get("status") ?? "draft") as "draft" | "active" | "out_of_stock" | "inactive",
      imageUrl: imageChanged ? imageUrl! : undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du produit";
    redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/products?success=" + encodeURIComponent("Produit mis à jour."));
}

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  let product;
  try {
    product = await getProductForEdit(organizationId, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Modifier le produit</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      <form action={updateProductAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="currentImageUrl" value={product.imageUrl ?? ""} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required defaultValue={product.name} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input
            name="price"
            type="number"
            min="0"
            required
            defaultValue={product.unitPrice}
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Stock
          <input
            name="stock"
            type="number"
            min="0"
            defaultValue={product.currentStock}
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Catégorie
          <input
            name="category"
            placeholder="Ex : Chaussures"
            defaultValue={product.categoryName ?? ""}
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Statut
          <select
            name="status"
            defaultValue={product.status}
            className="rounded-brand border border-ink/15 px-4 py-3 outline-none focus:border-leaf"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea
            name="description"
            rows={3}
            defaultValue={product.description ?? ""}
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
        </label>

        <ImageUploadField name="image" label="Photo du produit" currentUrl={product.imageUrl} />

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer les modifications</SubmitButton>
      </form>
    </div>
  );
}
