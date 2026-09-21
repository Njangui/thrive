import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getSiteMedia, updateSiteMedia } from "@/application/services/site-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { BUSINESS_DAYS, BUSINESS_LIMITS, getBusinessProfile, updateBusinessProfile } from "@/application/services/business-profile-service";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";
import { AppError } from "@/lib/errors";

/**
 * Lot O — Fiche entreprise + identité visuelle, accessibles à TOUS les
 * plans. Un site public professionnel (promesse Discover) suppose de
 * pouvoir corriger son téléphone, ses horaires ou son logo après
 * l'onboarding ; la personnalisation avancée (sections, couleurs,
 * polices, SEO, domaine) reste sur `/dashboard/site` (Starter+).
 */
async function saveBusinessProfileAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  try {
    const openingHours: Record<string, string> = {};
    for (const day of BUSINESS_DAYS) openingHours[day] = String(formData.get(`hours_${day}`) ?? "");
    await updateBusinessProfile(organizationId, {
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      whatsappNumber: String(formData.get("whatsappNumber") ?? ""),
      email: String(formData.get("email") ?? ""),
      address: String(formData.get("address") ?? ""),
      openingHours,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible d'enregistrer la fiche entreprise.";
    redirect(`/dashboard/business?error=${encodeURIComponent(message)}`);
  }
  redirect(`/dashboard/business?success=${encodeURIComponent("Fiche entreprise enregistrée.")}`);
}

async function saveIdentityAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);
  try {
    const current = {
      logo: String(formData.get("currentLogoUrl") ?? "") || undefined,
      banner: String(formData.get("currentBannerUrl") ?? "") || undefined,
      favicon: String(formData.get("currentFaviconUrl") ?? "") || undefined,
    };
    const [logoUrl, bannerUrl, faviconUrl] = await Promise.all([
      resolveImageFromFormData(formData, { organizationId, mediaType: "logo", fileField: "logoFile", urlField: "logoUrl", currentUrl: current.logo }),
      resolveImageFromFormData(formData, { organizationId, mediaType: "banner", fileField: "bannerFile", urlField: "bannerUrl", currentUrl: current.banner }),
      resolveImageFromFormData(formData, { organizationId, mediaType: "favicon", fileField: "faviconFile", urlField: "faviconUrl", currentUrl: current.favicon }),
    ]);
    await updateSiteMedia(organizationId, {
      logoUrl: (logoUrl ?? "") !== (current.logo ?? "") ? logoUrl ?? "" : undefined,
      bannerUrl: (bannerUrl ?? "") !== (current.banner ?? "") ? bannerUrl ?? "" : undefined,
      faviconUrl: (faviconUrl ?? "") !== (current.favicon ?? "") ? faviconUrl ?? "" : undefined,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible de mettre à jour votre identité visuelle.";
    redirect(`/dashboard/business?error=${encodeURIComponent(message)}`);
  }
  redirect(`/dashboard/business?success=${encodeURIComponent("Identité visuelle mise à jour.")}`);
}

const inputClass = "w-full rounded-xl border border-navy-900/10 bg-white px-3 py-2 text-sm";

export default async function BusinessPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [profile, media] = await Promise.all([getBusinessProfile(organizationId), getSiteMedia(organizationId)]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Fiche entreprise</h1>
        <p className="mt-1 text-sm text-slate-500">
          Vos coordonnées, horaires et identité : affichés sur votre site public et utilisés par les réponses automatiques.
        </p>
      </div>

      {success && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <form action={saveBusinessProfileAction} className="adm-card flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <h2 className="adm-heading-2 text-lg">Coordonnées</h2>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Nom de l&apos;entreprise
          <input name="name" defaultValue={profile.name} required maxLength={BUSINESS_LIMITS.name} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Description
          <textarea name="description" defaultValue={profile.description ?? ""} rows={4} maxLength={BUSINESS_LIMITS.description} className={inputClass} placeholder="Présentez votre activité en quelques phrases." />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Téléphone
            <input name="phone" defaultValue={profile.phone ?? ""} inputMode="tel" className={inputClass} placeholder="+237 6XX XX XX XX" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Numéro WhatsApp
            <input name="whatsappNumber" defaultValue={profile.whatsappNumber ?? ""} inputMode="tel" className={inputClass} placeholder="+237 6XX XX XX XX" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Email
            <input name="email" type="email" defaultValue={profile.email ?? ""} className={inputClass} placeholder="contact@votre-entreprise.cm" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
            Adresse
            <input name="address" defaultValue={profile.address ?? ""} maxLength={BUSINESS_LIMITS.address} className={inputClass} placeholder="Quartier, ville" />
          </label>
        </div>
        <div>
          <h3 className="text-sm font-semibold">Horaires d&apos;ouverture</h3>
          <p className="mt-1 text-xs text-slate-500">Laissez vide un jour pour ne pas l&apos;afficher. Exemple : « 8h – 18h » ou « Fermé ».</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {BUSINESS_DAYS.map((day) => (
              <label key={day} className="flex items-center gap-3 text-sm">
                <span className="w-24 capitalize text-slate-600">{day}</span>
                <input name={`hours_${day}`} defaultValue={profile.openingHours[day] ?? ""} maxLength={BUSINESS_LIMITS.hoursPerDay} className={inputClass} />
              </label>
            ))}
          </div>
        </div>
        <div>
          <SubmitButton pendingLabel="Enregistrement…" className="adm-btn-primary disabled:opacity-60">Enregistrer la fiche</SubmitButton>
        </div>
      </form>

      <form action={saveIdentityAction} className="adm-card flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="currentLogoUrl" value={media.logoUrl ?? ""} />
        <input type="hidden" name="currentBannerUrl" value={media.bannerUrl ?? ""} />
        <input type="hidden" name="currentFaviconUrl" value={media.faviconUrl ?? ""} />
        <h2 className="adm-heading-2 text-lg">Identité visuelle</h2>
        <ImageUploadField name="logo" label="Logo" currentUrl={media.logoUrl} helpText="Affiché en haut de votre page publique." />
        <ImageUploadField name="banner" label="Bannière" currentUrl={media.bannerUrl} helpText="Image large affichée en tête de votre page publique. Optionnel." />
        <ImageUploadField name="favicon" label="Icône du site (favicon)" currentUrl={media.faviconUrl} helpText="Petite icône affichée dans l'onglet du navigateur. Optionnel." />
        <div>
          <SubmitButton pendingLabel="Enregistrement…" className="adm-btn-primary disabled:opacity-60">Enregistrer l&apos;identité</SubmitButton>
        </div>
      </form>
    </div>
  );
}
