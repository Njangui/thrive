import { redirect } from "next/navigation";
import { requireAffiliate } from "@/application/services/affiliate-auth-service";
import { createAffiliateLink, listAffiliateLinks, setAffiliateLinkActive } from "@/application/services/affiliate-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

async function createLinkAction(formData: FormData) {
  "use server";
  const affiliate = await requireAffiliate();
  try {
    await createAffiliateLink(affiliate.id, {
      label: String(formData.get("label") ?? "") || undefined,
      destinationPath: String(formData.get("destinationPath") ?? "") || undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création du lien.";
    redirect(`/affiliate/dashboard/links?error=${encodeURIComponent(message)}`);
  }
  redirect("/affiliate/dashboard/links?success=1");
}

async function toggleLinkAction(formData: FormData) {
  "use server";
  const affiliate = await requireAffiliate();
  const linkId = String(formData.get("linkId") ?? "");
  const nextActive = formData.get("nextActive") === "true";
  await setAffiliateLinkActive(affiliate.id, linkId, nextActive);
  redirect("/affiliate/dashboard/links");
}

export default async function AffiliateLinksPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;

  let affiliate;
  try {
    affiliate = await requireAffiliate();
  } catch (err) {
    if (err instanceof AppError) redirect("/affiliate/apply");
    throw err;
  }

  const links = await listAffiliateLinks(affiliate.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Mes liens</h1>
        <p className="mt-1 text-sm text-muted">Créez un lien par canal (bio Instagram, vidéo YouTube...) pour suivre vos performances séparément.</p>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">Lien créé.</p>}
      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <form action={createLinkAction} className="flex flex-col gap-4 rounded-brand border border-ink/10 bg-white p-6 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="label">
            Étiquette (optionnel)
          </label>
          <input id="label" name="label" placeholder="ex : bio Instagram" className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="destinationPath">
            Destination (optionnel)
          </label>
          <input
            id="destinationPath"
            name="destinationPath"
            placeholder="/ (page d'accueil par défaut)"
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>
        <SubmitButton pendingLabel="Création...">Créer un lien</SubmitButton>
      </form>

      <div className="overflow-x-auto rounded-brand border border-ink/10 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-ink/10 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Lien</th>
              <th className="px-4 py-3">Étiquette</th>
              <th className="px-4 py-3">Clics</th>
              <th className="px-4 py-3">Conversions</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{link.trackingUrl}</td>
                <td className="px-4 py-3">{link.label ?? "—"}</td>
                <td className="px-4 py-3">{link.clickCount}</td>
                <td className="px-4 py-3">{link.conversionCount}</td>
                <td className="px-4 py-3">{link.isActive ? "Actif" : "Désactivé"}</td>
                <td className="px-4 py-3 text-right">
                  <form action={toggleLinkAction}>
                    <input type="hidden" name="linkId" value={link.id} />
                    <input type="hidden" name="nextActive" value={(!link.isActive).toString()} />
                    <button type="submit" className="text-xs font-medium text-leaf hover:underline">
                      {link.isActive ? "Désactiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {links.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Aucun lien pour le moment — créez-en un ci-dessus.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
