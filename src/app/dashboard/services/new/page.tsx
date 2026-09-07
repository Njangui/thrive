import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { createService } from "@/application/services/service-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

async function createServiceAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await createService({
      organizationId,
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      categoryName: String(formData.get("category") ?? "") || undefined,
      price: Number(formData.get("price") ?? 0),
      durationMinutes: formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : null,
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

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Nouveau service</h1>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <form action={createServiceAction} className="flex flex-col gap-3">
        <input type="hidden" name="organizationId" value={organizationId} />

        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input name="name" required placeholder="Ex : Coupe homme" className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Prix (FCFA)
          <input name="price" type="number" min="0" required className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Durée (minutes, optionnel)
          <input name="durationMinutes" type="number" min="1" placeholder="Ex : 30" className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Catégorie
          <input name="category" placeholder="Ex : Coiffure" className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea name="description" rows={3} className="rounded-brand border border-ink/15 px-4 py-3" />
        </label>

        <SubmitButton pendingLabel="Création en cours...">Créer le service</SubmitButton>
      </form>
    </div>
  );
}
