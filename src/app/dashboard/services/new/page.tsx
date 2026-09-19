import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { createService } from "@/application/services/service-service";
import { listCategories } from "@/application/services/catalog-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { AppError } from "@/lib/errors";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";
import { CategorySelect } from "../../_components/category-select";

async function createServiceAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const imageUrl = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "service",
      fileField: "imageFile",
      urlField: "imageUrl",
    });

    await createService({
      organizationId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryId: String(formData.get("categoryId") ?? ""),
      price: Number(formData.get("price") ?? 0),
      durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : null,
      imageUrl: imageUrl ?? undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création du service.";
    redirect(`/dashboard/services/new?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services?success=" + encodeURIComponent("Service créé."));
}

export default async function NewServicePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const categories = await listCategories(organizationId);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-jakarta text-2xl font-bold tracking-tight">Nouveau service</h1>

      {error && <p className="adm-alert-danger">{error}</p>}

      <form action={createServiceAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required placeholder="Ex : Coupe homme" className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input name="price" type="number" min="0" required className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Durée (minutes, optionnel)
          <input name="durationMinutes" type="number" min="1" placeholder="Ex : 30" className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <CategorySelect categories={categories} />

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" rows={3} className="rounded-xl border border-navy-900/10 px-4 py-3" />
        </label>

        <ImageUploadField
          name="image"
          label="Photo de la prestation"
          helpText="Optionnel — vous pourrez en ajouter d'autres plus tard depuis la fiche de la prestation."
        />

        <SubmitButton pendingLabel="Création en cours...">Créer le service</SubmitButton>
      </form>
    </div>
  );
}
