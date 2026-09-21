import { listCatalogVideos } from "@/application/services/catalog-video-service";
import { CatalogVideosPanel } from "../../../_components/catalog-videos-panel";
import { redirect, notFound } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  updateProduct,
  getProductForEdit,
  listProductImages,
  appendProductImages,
  removeProductImage,
  moveProductImage,
  setPrimaryProductImage,
  addProductSpecification,
  removeProductSpecification,
  restockProduct,
  listCategories,
} from "@/application/services/catalog-service";
import { resolveImagesFromFormData } from "@/application/services/media-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { PromotionDeadlineField } from "@/app/_components/promotion-deadline-field";
import { SubmitButton } from "@/app/_components/submit-button";
import { CategorySelect } from "../../../_components/category-select";

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
      categoryId: String(formData.get("categoryId") ?? ""),
      unitPrice: Number(formData.get("price") ?? 0),
      compareAtPrice: formData.get("compareAtPrice") ? Number(formData.get("compareAtPrice")) : null,
      promotionEndsAt: formData.get("promotionEndsAt")
        ? new Date(String(formData.get("promotionEndsAt"))).toISOString()
        : null,
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

async function addProductImagesAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const urls = await resolveImagesFromFormData(formData, {
      organizationId,
      mediaType: "product",
      filesField: "newImages",
      urlsField: "newImageUrls",
    });
    // Lève une AppError plutôt que d'appeler redirect() ici : redirect() lève NEXT_REDIRECT, que le
    // catch ci-dessous interceptait (le message affiché devenait « Erreur lors de l'ajout de la photo »).
    if (urls.length === 0) throw new AppError("Choisissez au moins une photo ou collez au moins un lien.", 400, "validation");
    await appendProductImages(organizationId, productId, urls);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout des photos.";
    redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/products/${productId}/edit?success=${encodeURIComponent("Photo(s) ajoutée(s).")}`);
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

// ---------------------------------------------------------------------------
// Catalogue V2 (0056) — "informations complémentaires" : mêmes règles que
// la galerie ci-dessus (une action dédiée par opération, jamais mêlée à
// updateProductAction).
// ---------------------------------------------------------------------------

async function addProductSpecificationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await addProductSpecification(
      organizationId,
      productId,
      String(formData.get("label") ?? ""),
      String(formData.get("value") ?? ""),
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout de l'information.";
    redirect(`/dashboard/products/${productId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/products/${productId}/edit?success=${encodeURIComponent("Information ajoutée.")}`);
}

async function removeProductSpecificationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const index = Number(formData.get("index") ?? -1);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  await removeProductSpecification(organizationId, productId, index);
  redirect(`/dashboard/products/${productId}/edit`);
}

// ---------------------------------------------------------------------------
// Écart identifié à la fusion (RAPPORT_FUSION_6.md, section 7) : le champ
// "Stock" ci-dessus permet de FIXER une valeur absolue, mais aucune
// interface n'appelait `restockProduct()` (catalog-service.ts, Lot 1) —
// qui, lui, applique la vraie règle métier de réapprovisionnement
// (section 18 : un produit OUT_OF_STOCK redevient ACTIVE automatiquement
// dès que le nouveau stock est positif, sans qu'il faille aussi penser à
// changer manuellement le champ "Statut" ci-dessus). Action séparée,
// volontairement DELTA ("+10 reçus") plutôt qu'absolue, pour un vrai
// réassort — complète le champ "Stock" plutôt que le remplacer.
// ---------------------------------------------------------------------------
async function restockProductAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const productId = String(formData.get("productId") ?? "");
  const quantity = Number(formData.get("restockQuantity") ?? 0);
  const membership = await requireMembership(organizationId, ["owner", "admin", "manager"]);

  if (!Number.isFinite(quantity) || quantity <= 0) {
    redirect(
      `/dashboard/products/${productId}/edit?error=${encodeURIComponent("Indiquez une quantité reçue supérieure à zéro.")}`,
    );
  }

  await restockProduct(organizationId, productId, quantity, membership.userId);
  redirect(
    `/dashboard/products/${productId}/edit?success=${encodeURIComponent(`+${quantity} ajouté${quantity > 1 ? "s" : ""} au stock.`)}`,
  );
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

  const [images, categories, videos] = await Promise.all([
    listProductImages(organizationId, id),
    listCategories(organizationId),
    // Vidéos expirées incluses : le commerçant doit voir qu'elles ont expiré pour les retéléverser.
    listCatalogVideos(organizationId, { productId: id, includeExpired: true }),
  ]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-jakarta text-2xl font-bold tracking-tight">Modifier le produit</h1>

      {error && (
        <p className="adm-alert-danger">{error}</p>
      )}
      {success && (
        <p className="adm-alert-success">{success}</p>
      )}

      <form action={updateProductAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={product.id} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required defaultValue={product.name} className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input
            name="price"
            type="number"
            min="0"
            required
            defaultValue={product.unitPrice}
            className="rounded-xl border border-navy-900/10 px-4 py-3"
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
            className="rounded-xl border border-navy-900/10 px-4 py-3"
          />
          <span className="text-xs text-slate-500">
            Doit être supérieur au prix ci-dessus — affiché barré, avec un badge « Promo », sur la fiche produit et
            dans la section Promotions de votre site.
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Fin de la promotion (optionnel)
          <PromotionDeadlineField defaultValueIso={product.promotionEndsAt} />
          <span className="text-xs text-slate-500">
            {product.isPromotionExpired
              ? "Cette échéance est dépassée : le compte à rebours et le prix barré ne sont plus affichés publiquement. Fixez une nouvelle date pour relancer la promotion, ou videz ce champ pour une promotion sans date de fin."
              : "Affiche un compte à rebours sur votre site tant que la promotion n'est pas terminée. Laissez vide pour une promotion sans date de fin."}
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Stock
          <input
            name="stock"
            type="number"
            min="0"
            defaultValue={product.currentStock}
            className="rounded-xl border border-navy-900/10 px-4 py-3"
          />
          <span className="text-xs text-slate-500">
            Fixe la valeur exacte du stock. Pour un réassort (nouvelle livraison reçue), utilisez plutôt
            « Réapprovisionner » ci-dessous — ça réactive automatiquement le produit s&apos;il était en rupture.
          </span>
        </label>

        <CategorySelect categories={categories} defaultValue={product.categoryId} />

        <label className="flex flex-col gap-1 text-sm">
          Statut
          <select
            name="status"
            defaultValue={product.status}
            className="rounded-xl border border-navy-900/10 px-4 py-3 outline-hidden focus:border-violet-400"
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
            className="rounded-xl border border-navy-900/10 px-4 py-3"
          />
        </label>

        <div className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
          <div>
            <p className="text-sm font-medium">Référencement sur Google (optionnel)</p>
            <p className="text-xs text-slate-500">
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
              className="rounded-xl border border-navy-900/10 px-4 py-3"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Description pour Google
            <textarea
              name="seoDescription"
              rows={2}
              maxLength={160}
              defaultValue={product.seoDescription ?? ""}
              className="rounded-xl border border-navy-900/10 px-4 py-3"
            />
          </label>
        </div>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer les modifications</SubmitButton>
      </form>

      {/* Réapprovisionnement — séparé du formulaire ci-dessus (delta, pas une valeur absolue). */}
      <form action={restockProductAction} className="flex flex-col gap-2 rounded-xl border border-navy-900/10 p-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="productId" value={product.id} />
        <p className="text-sm font-medium">Réapprovisionner</p>
        <p className="text-xs text-slate-500">
          Nouvelle livraison reçue ? Indiquez la quantité ajoutée — le stock actuel ({product.currentStock}) sera
          augmenté d&apos;autant, et le produit repassera automatiquement en « Actif » s&apos;il était en rupture.
        </p>
        <div className="flex gap-2">
          <input
            name="restockQuantity"
            type="number"
            min="1"
            placeholder="Quantité reçue"
            required
            className="w-32 rounded-xl border border-navy-900/10 px-4 py-3"
          />
          <SubmitButton pendingLabel="Ajout...">Ajouter au stock</SubmitButton>
        </div>
      </form>

      {/* Galerie photos — séparée du formulaire ci-dessus (voir en-tête du fichier). */}
      <div className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
        <div>
          <p className="text-sm font-medium">Photos du produit</p>
          <p className="text-xs text-slate-500">
            La première photo est celle utilisée sur votre site, dans WhatsApp et vos publications.
          </p>
        </div>

        {images.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune photo pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {images.map((image, index) => (
              <li key={image.id} className="flex items-center gap-3 rounded-xl border border-navy-900/10 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                <div className="min-w-0 flex-1">
                  {index === 0 ? (
                    <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-violet-600">
                      Photo principale
                    </span>
                  ) : (
                    <form action={setPrimaryProductImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="productId" value={product.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-violet-600 hover:underline disabled:opacity-60">
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
                      <button type="submit" aria-label="Monter" className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 hover:bg-navy-900/5">
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
                      <button type="submit" aria-label="Descendre" className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 hover:bg-navy-900/5">
                        ↓
                      </button>
                    </form>
                  )}
                  <form action={removeProductImageAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="productId" value={product.id} />
                    <input type="hidden" name="imageId" value={image.id} />
                    <SubmitButton pendingLabel="..." className="flex h-7 w-7 items-center justify-center rounded-xl text-danger-600 hover:bg-danger-50 disabled:opacity-60">
                      ✕
                    </SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form action={addProductImagesAction} className="flex flex-col gap-3 border-t border-navy-900/10 pt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="productId" value={product.id} />
          <label className="flex flex-col gap-1 text-sm">
            Ajouter des photos (plusieurs à la fois)
            <input type="file" name="newImages" multiple accept="image/*" className="text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ou coller plusieurs liens (un par ligne)
            <textarea
              name="newImageUrls"
              rows={2}
              placeholder="https://exemple.com/photo1.jpg"
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm"
            />
          </label>
          <SubmitButton pendingLabel="Ajout..." className="w-fit rounded-xl bg-navy-900/5 px-4 py-2 text-sm font-medium text-navy-900 hover:bg-navy-900/10 disabled:opacity-60">
            Ajouter ces photos
          </SubmitButton>
        </form>
      </div>

      {/* Informations complémentaires — catalogue V2 (0056), même principe que la galerie ci-dessus. */}
      <div className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
        <div>
          <p className="text-sm font-medium">Informations complémentaires</p>
          <p className="text-xs text-slate-500">
            Affichées en tableau sur la fiche produit publique — matière, garantie, dimensions, composition...
            (12 lignes maximum).
          </p>
        </div>

        {product.specifications.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune information complémentaire pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {product.specifications.map((spec, index) => (
              <li
                key={`${spec.label}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-navy-900/10 p-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{spec.label}</span> — {spec.value}
                </span>
                <form action={removeProductSpecificationAction}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="productId" value={product.id} />
                  <input type="hidden" name="index" value={index} />
                  <SubmitButton pendingLabel="..." className="shrink-0 text-xs text-danger-600 hover:underline disabled:opacity-60">
                    Supprimer
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}

        {product.specifications.length >= 12 ? (
          <p className="text-xs text-slate-500">
            Limite de 12 informations atteinte — supprimez-en une pour en ajouter une autre.
          </p>
        ) : (
          <form action={addProductSpecificationAction} className="flex flex-col gap-2 border-t border-navy-900/10 pt-3 sm:flex-row">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productId" value={product.id} />
            <input
              name="label"
              placeholder="Ex : Matière"
              maxLength={40}
              required
              className="flex-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
            />
            <input
              name="value"
              placeholder="Ex : Coton"
              maxLength={160}
              required
              className="flex-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
            />
            <SubmitButton pendingLabel="Ajout..." className="shrink-0 rounded-xl bg-navy-900/5 px-4 py-2 text-sm font-medium text-navy-900 hover:bg-navy-900/10 disabled:opacity-60">
              Ajouter
            </SubmitButton>
          </form>
        )}
      </div>

      <CatalogVideosPanel productId={product.id} videos={videos} />
    </div>
  );
}
