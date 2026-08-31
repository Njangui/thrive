import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { getSiteMedia, updateSiteMedia } from "@/application/services/site-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { AppError } from "@/lib/errors";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";

/**
 * NOTE DE PORTÉE (voir RAPPORT_LOT_E.md) : cette page n'existait pas dans
 * le projet fourni, alors que le cahier Lot E la décrit comme "existante".
 * Elle a été créée avec le scope STRICT demandé par la Partie 1 (logo,
 * bannière, favicon) — pas de couleurs/polices/description, qui relèvent
 * d'un autre lot.
 *
 * Lot H, Partie 1 : ajout des champs SEO (titre/description/image de
 * partage) qui vivent sur les mêmes colonnes `organizations`
 * (0022_seo_fields.sql) — voir site-service.ts pour la justification de ne
 * pas avoir créé un fichier séparé.
 */
async function updateSiteAction(formData: FormData) {
  "use server";

  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin"]);

  try {
    const current = {
      logo: String(formData.get("currentLogoUrl") ?? "") || undefined,
      banner: String(formData.get("currentBannerUrl") ?? "") || undefined,
      favicon: String(formData.get("currentFaviconUrl") ?? "") || undefined,
      seoOgImage: String(formData.get("currentSeoOgImageUrl") ?? "") || undefined,
    };

    const [logoUrl, bannerUrl, faviconUrl, seoOgImageUrl] = await Promise.all([
      resolveImageFromFormData(formData, {
        organizationId,
        mediaType: "logo",
        fileField: "logoFile",
        urlField: "logoUrl",
        currentUrl: current.logo,
      }),
      resolveImageFromFormData(formData, {
        organizationId,
        mediaType: "banner",
        fileField: "bannerFile",
        urlField: "bannerUrl",
        currentUrl: current.banner,
      }),
      resolveImageFromFormData(formData, {
        organizationId,
        mediaType: "favicon",
        fileField: "faviconFile",
        urlField: "faviconUrl",
        currentUrl: current.favicon,
      }),
      resolveImageFromFormData(formData, {
        organizationId,
        mediaType: "seo_og",
        fileField: "seoOgFile",
        urlField: "seoOgUrl",
        currentUrl: current.seoOgImage,
      }),
    ]);

    const seoTitle = String(formData.get("seoTitle") ?? "").trim();
    const seoDescription = String(formData.get("seoDescription") ?? "").trim();

    await updateSiteMedia(organizationId, {
      logoUrl: (logoUrl ?? "") !== (current.logo ?? "") ? logoUrl ?? "" : undefined,
      bannerUrl: (bannerUrl ?? "") !== (current.banner ?? "") ? bannerUrl ?? "" : undefined,
      faviconUrl: (faviconUrl ?? "") !== (current.favicon ?? "") ? faviconUrl ?? "" : undefined,
      seoOgImageUrl:
        (seoOgImageUrl ?? "") !== (current.seoOgImage ?? "") ? seoOgImageUrl ?? "" : undefined,
      seoTitle,
      seoDescription,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de votre site";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Votre site a été mis à jour."));
}

export default async function SitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const media = await getSiteMedia(organizationId);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">Mon site</h1>
      <p className="text-sm text-muted">
        Le logo, la bannière et l&apos;icône de votre site apparaissent sur la page que voient vos clients.
      </p>

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <form action={updateSiteAction} className="flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="currentLogoUrl" value={media.logoUrl ?? ""} />
        <input type="hidden" name="currentBannerUrl" value={media.bannerUrl ?? ""} />
        <input type="hidden" name="currentFaviconUrl" value={media.faviconUrl ?? ""} />
        <input type="hidden" name="currentSeoOgImageUrl" value={media.seoOgImageUrl ?? ""} />

        <ImageUploadField
          name="logo"
          label="Logo"
          currentUrl={media.logoUrl}
          helpText="Affiché en haut de votre page publique."
        />

        <ImageUploadField
          name="banner"
          label="Bannière"
          currentUrl={media.bannerUrl}
          helpText="Image large affichée en tête de votre page publique. Optionnel."
        />

        <ImageUploadField
          name="favicon"
          label="Icône du site (favicon)"
          currentUrl={media.faviconUrl}
          helpText="Petite icône affichée dans l'onglet du navigateur. Optionnel."
        />

        <div className="flex flex-col gap-4 rounded-brand border border-ink/15 p-4">
          <div>
            <p className="text-sm font-medium">Référencement sur Google</p>
            <p className="text-xs text-muted">
              Ce que Google et les réseaux sociaux affichent quand quelqu&apos;un trouve votre page. Laissez
              vide pour utiliser le nom et la description de votre entreprise par défaut.
            </p>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Titre pour Google</span>
            <input
              type="text"
              name="seoTitle"
              defaultValue={media.seoTitle ?? ""}
              maxLength={70}
              placeholder="Ex : Salon Élégance — Coiffure à Douala"
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Description pour Google</span>
            <textarea
              name="seoDescription"
              defaultValue={media.seoDescription ?? ""}
              maxLength={160}
              rows={3}
              placeholder="Une ou deux phrases qui donnent envie de cliquer."
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            />
          </label>

          <ImageUploadField
            name="seoOg"
            label="Image de partage"
            currentUrl={media.seoOgImageUrl}
            helpText="Affichée quand votre page est partagée sur WhatsApp, Facebook, etc. Optionnel."
          />
        </div>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer</SubmitButton>
      </form>
    </div>
  );
}
