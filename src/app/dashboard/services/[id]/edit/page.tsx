import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import {
  getServiceForEdit,
  updateService,
  listServiceImages,
  appendServiceImage,
  removeServiceImage,
  moveServiceImage,
  setPrimaryServiceImage,
  addServiceSpecification,
  removeServiceSpecification,
} from "@/application/services/service-service";
import { listCategories } from "@/application/services/catalog-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";
import { CategorySelect } from "../../../_components/category-select";

async function updateServiceAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await updateService(serviceId, organizationId, {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryId: String(formData.get("categoryId") ?? ""),
      price: Number(formData.get("price") ?? 0),
      durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : null,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du service.";
    redirect(`/dashboard/services/${serviceId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services?success=" + encodeURIComponent("Service mis à jour."));
}

// ---------------------------------------------------------------------------
// Catalogue V2 (0056) — galerie multi-photos, en miroir exact du bloc
// équivalent de /dashboard/products/[id]/edit/page.tsx (voir ce fichier
// pour le détail des choix). Écran auparavant sans AUCUNE gestion de
// photo pour les services.
// ---------------------------------------------------------------------------

async function addServiceImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const url = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "service",
      fileField: "newImageFile",
      urlField: "newImageUrl",
    });
    if (!url) {
      redirect(`/dashboard/services/${serviceId}/edit?error=${encodeURIComponent("Choisissez une photo ou collez un lien.")}`);
    }
    await appendServiceImage(organizationId, serviceId, url);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout de la photo.";
    redirect(`/dashboard/services/${serviceId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/services/${serviceId}/edit?success=${encodeURIComponent("Photo ajoutée.")}`);
}

async function removeServiceImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await removeServiceImage(organizationId, serviceId, imageId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la suppression de la photo.";
    redirect(`/dashboard/services/${serviceId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/services/${serviceId}/edit?success=${encodeURIComponent("Photo supprimée.")}`);
}

async function moveServiceImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  const direction = String(formData.get("direction") ?? "up") as "up" | "down";
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  await moveServiceImage(organizationId, serviceId, imageId, direction);
  redirect(`/dashboard/services/${serviceId}/edit`);
}

async function setPrimaryServiceImageAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const imageId = String(formData.get("imageId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  await setPrimaryServiceImage(organizationId, serviceId, imageId);
  redirect(`/dashboard/services/${serviceId}/edit?success=${encodeURIComponent("Photo principale mise à jour.")}`);
}

// ---------------------------------------------------------------------------
// Catalogue V2 (0056) — "informations complémentaires", en miroir exact du
// bloc équivalent de /dashboard/products/[id]/edit/page.tsx.
// ---------------------------------------------------------------------------

async function addServiceSpecificationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await addServiceSpecification(
      organizationId,
      serviceId,
      String(formData.get("label") ?? ""),
      String(formData.get("value") ?? ""),
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout de l'information.";
    redirect(`/dashboard/services/${serviceId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect(`/dashboard/services/${serviceId}/edit?success=${encodeURIComponent("Information ajoutée.")}`);
}

async function removeServiceSpecificationAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  const index = Number(formData.get("index") ?? -1);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  await removeServiceSpecification(organizationId, serviceId, index);
  redirect(`/dashboard/services/${serviceId}/edit`);
}

export default async function EditServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { id } = await params;
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  let service;
  try {
    service = await getServiceForEdit(organizationId, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return (
        <div className="mx-auto max-w-md">
          <p className="adm-alert-danger">
            Service introuvable.
          </p>
        </div>
      );
    }
    throw err;
  }

  const [images, categories] = await Promise.all([listServiceImages(organizationId, id), listCategories(organizationId)]);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-jakarta text-2xl font-bold tracking-tight">Modifier le service</h1>

      {error && <p className="adm-alert-danger">{error}</p>}
      {success && <p className="adm-alert-success">{success}</p>}

      <form action={updateServiceAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="serviceId" value={service.id} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required defaultValue={service.name} className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input
            name="price"
            type="number"
            min="0"
            required
            defaultValue={service.price}
            className="rounded-xl border border-navy-900/10 px-4 py-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Durée (minutes, optionnel)
          <input
            name="durationMinutes"
            type="number"
            min="1"
            defaultValue={service.durationMinutes ?? ""}
            className="rounded-xl border border-navy-900/10 px-4 py-3"
          />
        </label>

        <CategorySelect categories={categories} defaultValue={service.categoryId} />

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" rows={3} defaultValue={service.description ?? ""} className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer</SubmitButton>
      </form>

      {/* Galerie photos — catalogue V2 (0056), miroir de /dashboard/products/[id]/edit. */}
      <div className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
        <div>
          <p className="text-sm font-medium">Photos de la prestation</p>
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
                    <form action={setPrimaryServiceImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="serviceId" value={service.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <SubmitButton pendingLabel="..." className="text-xs font-medium text-violet-600 hover:underline disabled:opacity-60">
                        Définir comme principale
                      </SubmitButton>
                    </form>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {index > 0 && (
                    <form action={moveServiceImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="serviceId" value={service.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <input type="hidden" name="direction" value="up" />
                      <button type="submit" aria-label="Monter" className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 hover:bg-navy-900/5">
                        ↑
                      </button>
                    </form>
                  )}
                  {index < images.length - 1 && (
                    <form action={moveServiceImageAction}>
                      <input type="hidden" name="organizationId" value={organizationId} />
                      <input type="hidden" name="serviceId" value={service.id} />
                      <input type="hidden" name="imageId" value={image.id} />
                      <input type="hidden" name="direction" value="down" />
                      <button type="submit" aria-label="Descendre" className="flex h-7 w-7 items-center justify-center rounded-xl text-slate-500 hover:bg-navy-900/5">
                        ↓
                      </button>
                    </form>
                  )}
                  <form action={removeServiceImageAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="serviceId" value={service.id} />
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

        <form action={addServiceImageAction} className="flex flex-col gap-3 border-t border-navy-900/10 pt-3">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="serviceId" value={service.id} />
          <ImageUploadField name="newImage" label="Ajouter une photo" />
          <SubmitButton pendingLabel="Ajout..." className="w-fit rounded-xl bg-navy-900/5 px-4 py-2 text-sm font-medium text-navy-900 hover:bg-navy-900/10 disabled:opacity-60">
            Ajouter cette photo
          </SubmitButton>
        </form>
      </div>

      {/* Informations complémentaires — catalogue V2 (0056), miroir de /dashboard/products/[id]/edit. */}
      <div className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
        <div>
          <p className="text-sm font-medium">Informations complémentaires</p>
          <p className="text-xs text-slate-500">
            Affichées en tableau sur la fiche prestation publique — zone desservie, matériel utilisé, durée de
            validité... (12 lignes maximum).
          </p>
        </div>

        {service.specifications.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune information complémentaire pour l&apos;instant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {service.specifications.map((spec, index) => (
              <li
                key={`${spec.label}-${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-navy-900/10 p-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{spec.label}</span> — {spec.value}
                </span>
                <form action={removeServiceSpecificationAction}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="serviceId" value={service.id} />
                  <input type="hidden" name="index" value={index} />
                  <SubmitButton pendingLabel="..." className="shrink-0 text-xs text-danger-600 hover:underline disabled:opacity-60">
                    Supprimer
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}

        {service.specifications.length >= 12 ? (
          <p className="text-xs text-slate-500">
            Limite de 12 informations atteinte — supprimez-en une pour en ajouter une autre.
          </p>
        ) : (
          <form action={addServiceSpecificationAction} className="flex flex-col gap-2 border-t border-navy-900/10 pt-3 sm:flex-row">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="serviceId" value={service.id} />
            <input
              name="label"
              placeholder="Ex : Zone desservie"
              maxLength={40}
              required
              className="flex-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
            />
            <input
              name="value"
              placeholder="Ex : Yaoundé et environs"
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
    </div>
  );
}
