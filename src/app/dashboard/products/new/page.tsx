import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { createProduct } from "@/application/services/catalog-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { AppError } from "@/lib/errors";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";

async function createProductAction(formData: FormData) {
  "use server";

  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const imageUrl = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "product",
      fileField: "imageFile",
      urlField: "imageUrl",
    });

    await createProduct({
      organizationId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryName: String(formData.get("category") ?? "") || undefined,
      unitPrice: Number(formData.get("price") ?? 0),
      currentStock: Number(formData.get("stock") ?? 0),
      imageUrl: imageUrl ?? undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création du produit";
    redirect(`/dashboard/products/new?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/products?success=" + encodeURIComponent("Produit créé."));
}

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Nouveau produit</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      <form action={createProductAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input name="price" type="number" min="0" required className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Stock initial
          <input name="stock" type="number" min="0" defaultValue={0} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Catégorie
          <input name="category" placeholder="Ex : Chaussures" className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" rows={3} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <ImageUploadField
          name="image"
          label="Photo du produit"
          helpText="Optionnel — vous pourrez l'ajouter plus tard depuis la fiche produit."
        />

        <SubmitButton pendingLabel="Création en cours...">Créer le produit</SubmitButton>
      </form>
    </div>
  );
}
