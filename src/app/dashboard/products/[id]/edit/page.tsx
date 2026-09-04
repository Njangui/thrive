import { redirect, notFound } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  updateProduct,
  getProductForEdit,
  listProductImages,
  appendProductImage,
  removeProductImage,
  moveProductImage,
  setPrimaryProductImage,
} from "@/application/services/catalog-service";
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
    await updateProduct(productId, organizationId, {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryName: String(formData.get("category") ?? "") || undefined,
      unitPrice: Number(formData.get("price") ?? 0),
      compareAtPrice: formData.get("compareAtPrice") ? Number(formData.get("compareAtPrice")) : null,
      currentStock: Number(formData.get("stock") ?? 0),
      status: String(formData.get("status") ?? "draft") as "draft" | "active" | "out_of_stock" | "inactive",
      // Lot H, Partie 1 — pas explicitement listés par le cahier pour cette
      // page, mais ajoutés ici : sans eux, seo_title/seo_description du
      // produit (étendus côté backend, voir catalog-service.ts) ne seraient
      // réglables par AUCUNE interface, ce qui viderait de son sens le
      // critère d'acceptation "reflètent seo_title/seo_description du
      // produit s'ils sont renseignés" (personne ne pourrait jamais les
      // renseigner).
      seoTitle: String(formData.get("seoTitle") ?? "").trim(),
      seoDescription: String(formData.get("seoDescription") ?? "").trim(),
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du produit";
    redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/products?success=" + encodeURIComponent("Produit mis à jour."));
}

// ---------------------------------------------------------------------------
// Lot 2 (master prompt §15) — galerie multi-photos : ajouter, supprimer,
// réordonner, choisir la principale. Actions séparées de
// updateProductAction ci-dessus (une responsabilité chacune, jamais l'une
// qui écrase l'autre par effet de bord — voir catalog-service.ts).
// ---------------------------------------------------------------------------

async function addProductImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const url = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "product",
      fileField: "newImageFile",
      urlField: "newImageUrl",
    });
    if (!url) {
      redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent("Choisissez une photo ou collez un lien.")}`);
    }
    await appendProductImage(organizationId, productId, url);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout de la photo.";
    redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/products/${productId}/edit?success=${encodeURIComponent("Photo ajoutée.")}`);
}

async function removeProductImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await removeProductImage(organizationId, productId, imageId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la suppression de la photo.";
    redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/products/${productId}/edit?success=${encodeURIComponent("Photo supprimée.")}`);
}

async function moveProductImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  const direction = String(formData.get("direction") ?? "up") as "up" | "down";
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  await moveProductImage(organizationId, productId, imageId, direction);
  redirect(`/dashboard/products/${productId}/edit`);
}

async function setPrimaryProductImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  await setPrimaryProductImage(organizationId, productId, imageId);
  redirect(`/dashboard/products/${productId}/edit?success=${encodeURIComponent("Photo principale mise à jour.")}`);
}

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  let product;
  try {
    product = await getProductForEdit(organizationId, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const images = await listProductImages(organizationId, id);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Modifier le produit</h1>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <form action={updateProductAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={product.id} />

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
          Prix barré avant promotion (optionnel)
          <input
            name="compareAtPrice"
            type="number"
            min="0"
            defaultValue={product.compareAtPrice ?? ""}
            placeholder="Laissez vide si pas de promotion"
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
          <span className="text-xs text-muted">
            Doit être supérieur au prix ci-dessus — affiché barré, avec un badge « Promo », sur la fiche produit et
            dans la section Promotions de votre site.
          </span>
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

        <div className="flex flex-col gap-3 rounded-brand border border-ink/15 p-4">
          <div>
            <p className="text-sm font-medium">Référencement sur Google (optionnel)</p>
            <p className="text-xs text-muted">
              Laissez vide pour utiliser automatiquement le nom du produit et celui de votre entreprise.
            </p>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Titre pour Google
            <input
              name="seoTitle"
              maxLength={70}
              defaultValue={product.seoTitle ?? ""}
              placeholder={`${product.name} — ...`}
              className="rounded-brand border border-ink/15 px-4 py-3"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Description pour Google
            <textarea
              name="seoDescription"
              rows={2}
              maxLength={160}
              defaultValue={product.seoDescription ?? ""}
              className="rounded-brand border border-ink/15 px-4 py-3"
            />
          </label>
        </div>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer les modifications</SubmitButton>
      </form>

      {/* Galerie photos — séparée du formulaire ci-dessus (voir en-tête du fichier). */}
      <div className="flex flex-col gap-3 rounded-brand border border-ink/15 p-4">
        <div>
          <p className="text-sm font-medium">Photos du produit</p>
          <p className="text-xs text-muted">
            La première photo est celle utilisée sur votre site, dans WhatsApp et vos publications.
          </p>
        </div>

        {images.length === 0 ? (
          <p className="text-sm text-muted">Aucune photo pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {images.map((image, index) => (
              <li key={image.id} className="flex items-center gap-3 rounded-brand border border-ink/10 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-16 w-16 shrink-0 rounded-brand object-cover" />
                <div className="min-w-0 flex-1">
                  {index === 0 ? (
                    <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-medium text-leaf">
                      Photo principale
                    </span>
                  ) : (
                    <form action={setPrimaryProductImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-leaf hover:underline disabled:opacity-60">
                        Définir comme principale
                      </SubmitButton>
                    </form>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {index > 0 && (
                    <form action={moveProductImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button type="submit" aria-label="Monter" className="flex h-7 w-7 items-center justify-center rounded-brand text-muted hover:bg-ink/5">
                        ↑
                      </button>
                    </form>
                  )}
                  {index < images.length - 1 && (
                    <form action={moveProductImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button type="submit" aria-label="Descendre" className="flex h-7 w-7 items-center justify-center rounded-brand text-muted hover:bg-ink/5">
                        ↓
                      </button>
                    </form>
                  )}
                  <form action={removeProductImageAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="imageId" value={image.id} />
                    <SubmitButton pendingLabel="..." className="flex h-7 w-7 items-center justify-center rounded-brand text-clay hover:bg-clay/5 disabled:opacity-60">
                      ✕
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form action={addProductImageAction} className="flex flex-col gap-3 border-t border-ink/10 pt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="productId" value={product.id} />
          <ImageUploadField name="newImage" label="Ajouter une photo" />
          <SubmitButton pendingLabel="Ajout..." className="w-fit rounded-brand bg-ink/5 px-4 py-2 text-sm font-medium text-ink hover:bg-ink/10 disabled:opacity-60">
            Ajouter cette photo
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
