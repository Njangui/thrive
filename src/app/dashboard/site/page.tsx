import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { getSiteMedia, updateSiteMedia } from "@/application/services/site-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { listActiveTldPricing, listMyDomainRequests, requestDomain } from "@/application/services/domain-service";
import {
  getLandingConfig,
  updateLandingConfig,
  listTestimonials,
  createTestimonial,
  deleteTestimonial,
} from "@/application/services/landing-config-service";
import { LANDING_SECTION_LABELS } from "@/application/config/landing-presets";
import { FONT_CHOICES, type FontChoice } from "@/domain/entities/landing";
import { FONT_CHOICE_LABELS } from "@/app/fonts";
import { AppError, ValidationError } from "@/lib/errors";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";
import { DomainSearchField } from "./domain-search-field";

/**
 * NOTE DE PORTÉE (voir RAPPORT_LOT_E.md) : cette page n'existait pas dans
 * le projet fourni, alors que le cahier Lot E la décrit comme "existante".
 * Elle a été créée avec le scope STRICT demandé par la Partie 1 (logo,
 * bannière, favicon) — Lot H y a ajouté le SEO, Lot K y ajoute les
 * sections/couleurs/police/témoignages/réseaux sociaux (voir cahier
 * Lot K : "étendez le fichier existant, ne le réécrivez pas").
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

    // Lot K : réseaux sociaux — colonne organizations.social_links, déjà
    // lue par la vitrine publique mais jamais écrite nulle part avant ce
    // lot (voir site-service.ts). Toujours fournis (même vides — un champ
    // vidé par le commerçant doit pouvoir effacer un lien existant),
    // contrairement aux images qui ont besoin d'une logique "changé ou
    // pas" pour éviter un ré-upload inutile.
    await updateSiteMedia(organizationId, {
      logoUrl: (logoUrl ?? "") !== (current.logo ?? "") ? logoUrl ?? "" : undefined,
      bannerUrl: (bannerUrl ?? "") !== (current.banner ?? "") ? bannerUrl ?? "" : undefined,
      faviconUrl: (faviconUrl ?? "") !== (current.favicon ?? "") ? faviconUrl ?? "" : undefined,
      seoOgImageUrl:
        (seoOgImageUrl ?? "") !== (current.seoOgImage ?? "") ? seoOgImageUrl ?? "" : undefined,
      seoTitle,
      seoDescription,
      socialLinks: {
        facebook: String(formData.get("socialFacebook") ?? "").trim(),
        instagram: String(formData.get("socialInstagram") ?? "").trim(),
        tiktok: String(formData.get("socialTiktok") ?? "").trim(),
        linkedin: String(formData.get("socialLinkedin") ?? "").trim(),
      },
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de votre site";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Votre site a été mis à jour."));
}

/**
 * Lot G, Partie 3 — ajout délibéré non listé dans le cahier (qui ne
 * mentionne que /admin/domains) : sans point d'entrée tenant, aucune
 * ligne `domain_requests` ne pourrait jamais être créée. Voir
 * RAPPORT_LOT_G.md, section "Écarts assumés".
 */
async function requestDomainAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const domainName = String(formData.get("domainName") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  try {
    await requestDomain(organizationId, domainName, membership.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la demande de domaine";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Votre demande de domaine a été transmise."));
}

// ============================================================
// Lot K — sections de la page (activation/ordre) + couleurs/police
// ============================================================

async function toggleSectionAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const sectionType = String(formData.get("sectionType") ?? "");
    const nextEnabled = String(formData.get("enabled") ?? "") === "true";

    const config = await getLandingConfig(organizationId);
    const sections = config.sections.map((section) =>
      section.type === sectionType ? { ...section, enabled: nextEnabled } : section,
    );

    await updateLandingConfig(organizationId, {
      sections,
      brandColorPrimary: config.brandColorPrimary,
      brandColorSecondary: config.brandColorSecondary,
      fontChoice: config.fontChoice,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de la section.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Section mise à jour."));
}

/**
 * "monter"/"descendre" plutôt qu'un glisser-déposer (cahier Lot K : "pas
 * de sur-ingénierie sur l'UI de réordonnancement, l'important est que ça
 * fonctionne") — un aller-retour serveur complet par clic, même pattern
 * que `updateStatusAction` (dashboard/appointments/page.tsx) : pas d'état
 * client à gérer, la page se ré-affiche déjà à jour après le redirect.
 */
async function moveSectionAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const sectionType = String(formData.get("sectionType") ?? "");
    const direction = String(formData.get("direction") ?? "");

    const config = await getLandingConfig(organizationId);
    const sections = [...config.sections].sort((a, b) => a.order - b.order);
    const index = sections.findIndex((section) => section.type === sectionType);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    const current = sections[index];
    const target = sections[targetIndex];

    if (!current || !target) {
      // Volontairement une ValidationError (AppError) plutôt qu'un
      // redirect() direct ici : un redirect() DANS ce try serait
      // intercepté par le catch ci-dessous (Next.js implémente
      // redirect() en levant une erreur), qui appellerait alors un
      // second redirect() avec un message générique — voir
      // RAPPORT_LOT_K.md pour cette mise au point.
      throw new ValidationError("Déplacement impossible.");
    }

    sections[index] = target;
    sections[targetIndex] = current;

    await updateLandingConfig(organizationId, {
      sections: sections.map((section, i) => ({ type: section.type, enabled: section.enabled, order: i })),
      brandColorPrimary: config.brandColorPrimary,
      brandColorSecondary: config.brandColorSecondary,
      fontChoice: config.fontChoice,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du réordonnancement.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Ordre mis à jour."));
}

async function updateBrandingAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const config = await getLandingConfig(organizationId);
    await updateLandingConfig(organizationId, {
      sections: config.sections,
      brandColorPrimary: String(formData.get("brandColorPrimary") ?? "") || null,
      brandColorSecondary: String(formData.get("brandColorSecondary") ?? "") || null,
      fontChoice: (String(formData.get("fontChoice") ?? "") || null) as FontChoice | null,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de l'apparence.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Apparence mise à jour."));
}

async function createTestimonialAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const ratingRaw = String(formData.get("rating") ?? "");
    await createTestimonial({
      organizationId,
      authorName: String(formData.get("authorName") ?? ""),
      content: String(formData.get("content") ?? ""),
      rating: ratingRaw ? Number(ratingRaw) : null,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'ajout du témoignage.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Témoignage ajouté."));
}

async function deleteTestimonialAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await deleteTestimonial(organizationId, String(formData.get("testimonialId") ?? ""));
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la suppression du témoignage.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Témoignage retiré."));
}

const DOMAIN_STATUS_LABEL: Record<string, string> = {
  requested: "En attente de traitement",
  processing: "En cours de traitement",
  registered: "Enregistré",
  failed: "Échoué",
  cancelled: "Annulé",
};

export default async function SitePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [media, tldPricing, domainRequests, landingConfig, testimonials] = await Promise.all([
    getSiteMedia(organizationId),
    listActiveTldPricing(),
    listMyDomainRequests(organizationId),
    getLandingConfig(organizationId),
    listTestimonials(organizationId),
  ]);

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

        <div className="flex flex-col gap-4 rounded-brand border border-ink/15 p-4">
          <div>
            <p className="text-sm font-medium">Réseaux sociaux</p>
            <p className="text-xs text-muted">
              Affichés dans la section « Réseaux sociaux » de votre page si elle est activée. Laissez vide ce
              que vous n&apos;avez pas.
            </p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Facebook</span>
            <input
              type="url"
              name="socialFacebook"
              defaultValue={media.socialLinks.facebook ?? ""}
              placeholder="https://facebook.com/..."
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Instagram</span>
            <input
              type="url"
              name="socialInstagram"
              defaultValue={media.socialLinks.instagram ?? ""}
              placeholder="https://instagram.com/..."
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">TikTok</span>
            <input
              type="url"
              name="socialTiktok"
              defaultValue={media.socialLinks.tiktok ?? ""}
              placeholder="https://tiktok.com/@..."
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">LinkedIn</span>
            <input
              type="url"
              name="socialLinkedin"
              defaultValue={media.socialLinks.linkedin ?? ""}
              placeholder="https://linkedin.com/company/..."
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            />
          </label>
        </div>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer</SubmitButton>
      </form>

      {/* Lot K — Sections de ma page */}
      <div className="mt-4 flex flex-col gap-4 border-t border-ink/10 pt-6">
        <div>
          <h2 className="font-display text-lg font-semibold">Sections de ma page</h2>
          <p className="mt-1 text-sm text-muted">
            Activez, désactivez et réordonnez les sections affichées sur votre page publique.
            {!landingConfig.isCustomized &&
              " Cette liste correspond aux sections par défaut de votre secteur d'activité — personnalisez-la librement, elle ne sera enregistrée qu'à votre première modification."}
          </p>
        </div>

        <ul className="flex flex-col gap-2">
          {landingConfig.sections.map((section, index) => (
            <li
              key={section.type}
              className="flex items-center gap-3 rounded-brand border border-ink/10 bg-white px-3 py-2"
            >
              <form action={toggleSectionAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="sectionType" value={section.type} />
                <input type="hidden" name="enabled" value={section.enabled ? "false" : "true"} />
                <SubmitButton
                  pendingLabel="…"
                  className={`flex h-6 w-6 items-center justify-center rounded border text-xs font-bold ${
                    section.enabled ? "border-leaf bg-leaf text-white" : "border-ink/20 bg-white text-transparent"
                  }`}
                >
                  ✓
                </SubmitButton>
              </form>

              <span className="flex-1 text-sm font-medium">{LANDING_SECTION_LABELS[section.type]}</span>

              <form action={moveSectionAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="sectionType" value={section.type} />
                <input type="hidden" name="direction" value="up" />
                <SubmitButton
                  disabled={index === 0}
                  pendingLabel="…"
                  className="rounded-brand border border-ink/15 px-2 py-1 text-xs disabled:opacity-30"
                >
                  ↑
                </SubmitButton>
              </form>
              <form action={moveSectionAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="sectionType" value={section.type} />
                <input type="hidden" name="direction" value="down" />
                <SubmitButton
                  disabled={index === landingConfig.sections.length - 1}
                  pendingLabel="…"
                  className="rounded-brand border border-ink/15 px-2 py-1 text-xs disabled:opacity-30"
                >
                  ↓
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Le pied de page (coordonnées, mentions) est toujours affiché, quelle que soit cette configuration.
        </p>

        <form action={updateBrandingAction} className="flex flex-col gap-3 rounded-brand border border-ink/15 p-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <p className="text-sm font-medium">Couleurs et police</p>
          <div className="flex gap-6">
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Couleur principale</span>
              <input
                type="color"
                name="brandColorPrimary"
                defaultValue={landingConfig.brandColorPrimary ?? "#0f172a"}
                className="h-10 w-16 rounded-brand border border-ink/15"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Couleur secondaire</span>
              <input
                type="color"
                name="brandColorSecondary"
                defaultValue={landingConfig.brandColorSecondary ?? "#10b981"}
                className="h-10 w-16 rounded-brand border border-ink/15"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Police</span>
            <select
              name="fontChoice"
              defaultValue={landingConfig.fontChoice}
              className="rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf"
            >
              {FONT_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {FONT_CHOICE_LABELS[choice]}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton pendingLabel="Enregistrement...">Enregistrer l&apos;apparence</SubmitButton>
        </form>

        <a href="/" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand hover:underline">
          Voir mon site →
        </a>
      </div>

      {/* Lot K — Témoignages */}
      <div className="mt-4 flex flex-col gap-4 border-t border-ink/10 pt-6">
        <div>
          <h2 className="font-display text-lg font-semibold">Témoignages</h2>
          <p className="mt-1 text-sm text-muted">
            Affichés dans la section « Témoignages » de votre page si elle est activée.
          </p>
        </div>

        <form action={createTestimonialAction} className="flex flex-col gap-3 rounded-brand border border-ink/15 p-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col gap-1 text-sm">
            Nom du client
            <input name="authorName" required className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Témoignage
            <textarea name="content" required rows={2} className="rounded-brand border border-ink/15 px-4 py-3" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note (optionnel)
            <select name="rating" defaultValue="" className="rounded-brand border border-ink/15 px-4 py-3">
              <option value="">Aucune note</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} étoile{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
          <SubmitButton pendingLabel="Ajout...">Ajouter le témoignage</SubmitButton>
        </form>

        {testimonials.length > 0 && (
          <ul className="flex flex-col gap-2">
            {testimonials.map((testimonial) => (
              <li
                key={testimonial.id}
                className="flex items-start justify-between gap-3 rounded-brand border border-ink/10 bg-white px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {testimonial.authorName}
                    {testimonial.rating ? ` — ${testimonial.rating}★` : ""}
                  </p>
                  <p className="text-muted">{testimonial.content}</p>
                </div>
                <form action={deleteTestimonialAction}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="testimonialId" value={testimonial.id} />
                  <SubmitButton
                    pendingLabel="…"
                    className="shrink-0 rounded-brand bg-ink/5 px-2 py-1 text-xs font-medium text-ink transition-colors hover:bg-clay/10 hover:text-clay disabled:opacity-60"
                  >
                    Retirer
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 border-t border-ink/10 pt-6">
        <div>
          <h2 className="font-display text-lg font-semibold">Domaine personnalisé</h2>
          <p className="mt-1 text-sm text-muted">
            Demandez un nom de domaine pour votre boutique — traité manuellement par notre équipe (aucun registrar
            n&apos;est encore branché automatiquement).
          </p>
        </div>

        {tldPricing.length === 0 ? (
          <p className="text-sm text-muted">Aucune extension n&apos;est proposée à la vente pour le moment.</p>
        ) : (
          <>
            <form action={requestDomainAction} className="flex flex-col gap-2">
              <input type="hidden" name="organizationId" value={organizationId} />
              <DomainSearchField organizationId={organizationId} />
              <p className="text-xs text-muted">
                Extensions disponibles :{" "}
                {tldPricing.map((t) => `${t.tld} (${t.soldPriceFcfa.toLocaleString("fr-FR")} FCFA)`).join(", ")}
              </p>
              <SubmitButton pendingLabel="Envoi...">Demander ce domaine</SubmitButton>
            </form>

            {domainRequests.length > 0 && (
              <ul className="flex flex-col gap-2">
                {domainRequests.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between rounded-brand border border-ink/10 bg-white px-4 py-3 text-sm"
                  >
                    <span className="font-medium text-ink">{r.domainName}</span>
                    <span className="text-xs text-muted">{DOMAIN_STATUS_LABEL[r.status] ?? r.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
