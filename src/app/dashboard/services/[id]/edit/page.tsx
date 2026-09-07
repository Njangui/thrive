import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { getServiceForEdit, updateService } from "@/application/services/service-service";
import { AppError, NotFoundError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

async function updateServiceAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const serviceId = String(formData.get("serviceId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await updateService(serviceId, organizationId, {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryName: String(formData.get("category") ?? "") || undefined,
      price: Number(formData.get("price") ?? 0),
      durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : null,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour du service.";
    redirect(`/dashboard/services/${serviceId}/edit?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services?success=" + encodeURIComponent("Service mis à jour."));
}

export default async function EditServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();

  let service;
  try {
    service = await getServiceForEdit(organizationId, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      return (
        <div className="mx-auto max-w-md">
          <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">
            Service introuvable.
          </p>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Modifier le service</h1>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <form action={updateServiceAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="serviceId" value={service.id} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required defaultValue={service.name} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input
            name="price"
            type="number"
            min="0"
            required
            defaultValue={service.price}
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Durée (minutes, optionnel)
          <input
            name="durationMinutes"
            type="number"
            min="1"
            defaultValue={service.durationMinutes ?? ""}
            className="rounded-brand border border-ink/15 px-4 py-3"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Catégorie
          <input name="category" defaultValue={service.categoryName ?? ""} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" rows={3} defaultValue={service.description ?? ""} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer</SubmitButton>
      </form>
    </div>
  );
}
