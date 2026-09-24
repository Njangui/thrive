import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { getSiteMedia, updateSiteMedia } from "@/application/services/site-service";
import { resolveImageFromFormData } from "@/application/services/media-service";
import { listActiveTldPricing, listMyDomainRequests, requestDomain } from "@/application/services/domain-service";
import {
  getLandingConfig,
  getOrganizationIndustry,
  updateLandingConfig,
  resetLandingConfig,
  listTestimonials,
  createTestimonial,
  deleteTestimonial,
} from "@/application/services/landing-config-service";
import { LANDING_SECTION_LABELS, LANDING_PRESET_KEYS, LANDING_PRESET_LABELS, LANDING_PRESET_DESCRIPTIONS, SECTOR_TO_PRESET, buildDefaultSections } from "@/application/config/landing-presets";
import { getStorefrontBlueprint } from "@/application/config/storefront-blueprint";
import {
  FONT_CHOICES,
  HERO_LAYOUTS,
  HERO_LAYOUT_LABELS,
  HIGHLIGHT_ICON_KEYS,
  PAYMENT_METHOD_KEYS,
  PAYMENT_METHOD_LABELS,
  LandingHighlightsSchema,
  type FontChoice,
  type HeroLayout,
  type HighlightIconKey,
  type LandingHighlight,
  type PaymentMethodKey,
} from "@/domain/entities/landing";
import { FONT_CHOICE_LABELS } from "@/app/fonts";
import { ImageUploadField } from "@/app/_components/image-upload-field";
import { SubmitButton } from "@/app/_components/submit-button";
import { ResetSiteButton } from "./reset-site-button";
import { HighlightIcon } from "@/app/_components/storefront/storefront-icons";
import { DomainSearchField } from "./domain-search-field";
import { env } from "@/lib/env";
import { canUseFeature } from "@/application/services/entitlements-service";
import { AppError, ValidationError, QuotaExceededError } from "@/lib/errors";

/** Libellés FR des icônes de la bande de confiance, pour le sélecteur du formulaire (voir updateHighlightsAction plus bas). Purement de l'affichage dashboard — la clé technique reste celle de storefront-blueprint.ts. */
const HIGHLIGHT_ICON_LABELS: Record<HighlightIconKey, string> = {
  truck: "Livraison",
  wallet: "Paiement",
  shield: "Garantie / sécurité",
  headset: "Support client",
  clock: "Horaires",
  pin: "Localisation",
  sparkles: "Qualité / soin",
  star: "Avis / satisfaction",
  chef: "Cuisine / préparation",
  leaf: "Fraîcheur / naturel",
  scissors: "Coiffure / beauté",
  calendar: "Rendez-vous",
  briefcase: "Professionnalisme",
  handshake: "Confiance / accompagnement",
  key: "Immobilier / accès",
  ruler: "Détails / mesures",
  whatsapp: "WhatsApp",
  bag: "Achat",
};

const HIGHLIGHT_SLOTS = 4;

async function requireSiteCustomization(organizationId: string): Promise<void> {
  const entitlement = await canUseFeature(organizationId, "site_customization", 1);
  if (!entitlement.allowed) {
    throw new QuotaExceededError("La personnalisation de la vitrine est disponible à partir de Starter.");
  }
}

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
  await requireSiteCustomization(organizationId);
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
  await requireSiteCustomization(organizationId);
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
  await requireSiteCustomization(organizationId);
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
      heroTitle: config.heroTitle,
      heroSubtitle: config.heroSubtitle,
      ctaLabel: config.ctaLabel,
      ctaUrl: config.ctaUrl,
      visualStyle: config.visualStyle,
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
  await requireSiteCustomization(organizationId);
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
      heroTitle: config.heroTitle,
      heroSubtitle: config.heroSubtitle,
      ctaLabel: config.ctaLabel,
      ctaUrl: config.ctaUrl,
      visualStyle: config.visualStyle,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors du réordonnancement.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Ordre mis à jour."));
}

async function applyPresetAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const preset = String(formData.get("preset") ?? "default") as (typeof LANDING_PRESET_KEYS)[number];
  if (!LANDING_PRESET_KEYS.includes(preset)) redirect("/dashboard/site?error=Preset%20invalide");
  try {
    const config = await getLandingConfig(organizationId);
    await updateLandingConfig(organizationId, { sections: buildDefaultSections(preset), brandColorPrimary: config.brandColorPrimary, brandColorSecondary: config.brandColorSecondary, fontChoice: config.fontChoice, heroTitle: config.heroTitle, heroSubtitle: config.heroSubtitle, ctaLabel: config.ctaLabel, ctaUrl: config.ctaUrl, visualStyle: config.visualStyle });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible d'appliquer ce modèle.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/site?success=" + encodeURIComponent("Structure de page appliquée."));
}

async function updateHeroAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  try {
    const config = await getLandingConfig(organizationId);

    // Visuel d'en-tête : même mécanique mixte upload/URL que
    // logo/bannière/favicon (ImageUploadField + resolveImageFromFormData),
    // gardée cohérente avec le reste de cet écran plutôt que d'inventer un
    // second pattern pour une seule image.
    const heroMediaUrl = await resolveImageFromFormData(formData, {
      organizationId,
      mediaType: "hero",
      fileField: "heroMediaFile",
      urlField: "heroMediaUrl",
      currentUrl: config.heroMediaUrl ?? undefined,
    });

    const heroLayoutRaw = String(formData.get("heroLayout") ?? "");
    const heroLayout = HERO_LAYOUTS.includes(heroLayoutRaw as HeroLayout) ? (heroLayoutRaw as HeroLayout) : null;

    await updateLandingConfig(organizationId, {
      sections: config.sections,
      brandColorPrimary: config.brandColorPrimary,
      brandColorSecondary: config.brandColorSecondary,
      fontChoice: config.fontChoice,
      heroTitle: String(formData.get("heroTitle") ?? "") || null,
      heroSubtitle: String(formData.get("heroSubtitle") ?? "") || null,
      ctaLabel: String(formData.get("ctaLabel") ?? "") || null,
      ctaUrl: String(formData.get("ctaUrl") ?? "") || null,
      visualStyle: (String(formData.get("visualStyle") ?? "soft") || "soft") as "soft" | "clean" | "bold",
      announcement: String(formData.get("announcement") ?? "") || null,
      announcementEnabled: formData.get("announcementEnabled") === "on",
      heroLayout,
      heroMediaUrl: (heroMediaUrl ?? "") !== (config.heroMediaUrl ?? "") ? heroMediaUrl : undefined,
      secondaryCtaLabel: String(formData.get("secondaryCtaLabel") ?? "") || null,
      secondaryCtaUrl: String(formData.get("secondaryCtaUrl") ?? "") || null,
      showStats: formData.get("showStats") === "on",
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la personnalisation.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }
  redirect("/dashboard/site?success=" + encodeURIComponent("Personnalisation enregistrée."));
}

/**
 * Bande de confiance (jusqu'à 4 promesses). Formulaire à créneaux fixes
 * plutôt qu'un ajout dynamique en JavaScript (cahier historique du
 * projet : pas de sur-ingénierie sur ce type d'UI, voir moveSectionAction
 * ci-dessus) — 4 blocs identiques, un créneau au TITRE vide est
 * simplement omis du tableau enregistré.
 *
 * Un tableau VIDE (les 4 titres laissés vides) est une valeur légitime :
 * le commerçant retire volontairement la bande. C'est distinct de
 * `resetHighlightsAction` ci-dessous, qui revient aux promesses par
 * défaut du secteur (voir resolveStorefrontHighlights).
 */
async function updateHighlightsAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const highlights: LandingHighlight[] = [];
    for (let i = 0; i < HIGHLIGHT_SLOTS; i += 1) {
      const title = String(formData.get(`highlightTitle${i}`) ?? "").trim();
      if (!title) continue;
      const iconRaw = String(formData.get(`highlightIcon${i}`) ?? "sparkles");
      const icon = (HIGHLIGHT_ICON_KEYS as readonly string[]).includes(iconRaw) ? (iconRaw as HighlightIconKey) : "sparkles";
      const subtitle = String(formData.get(`highlightSubtitle${i}`) ?? "").trim();
      highlights.push({ icon, title, subtitle });
    }

    const parsed = LandingHighlightsSchema.safeParse(highlights);
    if (!parsed.success) throw new ValidationError("Bande de confiance invalide.");

    const config = await getLandingConfig(organizationId);
    await updateLandingConfig(organizationId, { sections: config.sections, highlights: parsed.data });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour de la bande de confiance.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Bande de confiance mise à jour."));
}

/** Revient aux promesses par défaut du secteur — distinct d'un tableau vide (« aucune »), voir le commentaire ci-dessus. */
async function resetSiteDesignAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await resetLandingConfig(organizationId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Impossible de réinitialiser votre vitrine.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Votre vitrine est revenue au design de base de votre secteur. Vos données et votre identité restent conservées."));
}

async function resetHighlightsAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const config = await getLandingConfig(organizationId);
    await updateLandingConfig(organizationId, { sections: config.sections, highlights: null });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la réinitialisation.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Bande de confiance réinitialisée sur votre secteur."));
}

/**
 * Moyens de paiement affichés en pied de page. Une case cochée n'engage
 * QUE le commerçant — jamais pré-cochée par défaut à la création d'un
 * tenant (voir 0052_storefront_v2.sql, commentaire sur payment_methods) :
 * afficher un logo Visa chez quelqu'un qui n'accepte que le cash
 * tromperait son client.
 */
async function updatePaymentMethodsAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const selected = PAYMENT_METHOD_KEYS.filter((key) => formData.get(`payment_${key}`) === "on");
    const config = await getLandingConfig(organizationId);
    await updateLandingConfig(organizationId, { sections: config.sections, paymentMethods: selected });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour des moyens de paiement.";
    redirect(`/dashboard/site?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/site?success=" + encodeURIComponent("Moyens de paiement mis à jour."));
}

async function updateBrandingAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireSiteCustomization(organizationId);
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    const config = await getLandingConfig(organizationId);
    await updateLandingConfig(organizationId, {
      sections: config.sections,
      brandColorPrimary: String(formData.get("brandColorPrimary") ?? "") || null,
      brandColorSecondary: String(formData.get("brandColorSecondary") ?? "") || null,
      fontChoice: (String(formData.get("fontChoice") ?? "") || null) as FontChoice | null,
      heroTitle: config.heroTitle,
      heroSubtitle: config.heroSubtitle,
      ctaLabel: config.ctaLabel,
      ctaUrl: config.ctaUrl,
      visualStyle: config.visualStyle,
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
  await requireSiteCustomization(organizationId);
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
  await requireSiteCustomization(organizationId);
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
  const customization = await canUseFeature(organizationId, "site_customization", 1);
  if (!customization.allowed) {
    return (
      <div className="tokoo -page">
        <section className="tokoo -page-hero">
          <div>
            <p className="tokoo -eyebrow">Ma vitrine</p>
            <h1 className="mt-2 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Votre site professionnel est déjà prêt.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">Discover utilise le design professionnel de base de votre secteur. La personnalisation complète est disponible à partir de Starter.</p>
          </div>
          <div className="flex flex-wrap gap-2"><a href="/dashboard/business" className="adm-btn-primary bg-white text-navy-900 hover:bg-white/90">Modifier ma fiche entreprise</a><a href="/dashboard/subscription" className="adm-btn-primary bg-white/10 text-white hover:bg-white/20">Voir Starter</a></div>
        </section>
        <section className="tokoo -info-panel mt-5">
          <div><p className="font-semibold text-navy-900">Design de base actif</p><p className="mt-1 text-sm text-slate-500">Votre catalogue, vos informations, votre identité publique et vos contenus restent disponibles. Seuls les réglages de personnalisation sont verrouillés sur Discover.</p></div>
        </section>
      </div>
    );
  }
  const [media, tldPricing, domainRequests, landingConfig, testimonials, industry] = await Promise.all([
    getSiteMedia(organizationId),
    listActiveTldPricing(),
    listMyDomainRequests(organizationId),
    getLandingConfig(organizationId),
    listTestimonials(organizationId),
    getOrganizationIndustry(organizationId),
  ]);
  // Secteur de la vitrine — sert uniquement à afficher, dans l'éditeur de
  // bande de confiance, à quoi ressemblent les promesses par défaut avant
  // personnalisation (voir resolveStorefrontHighlights, storefront-service.ts,
  // qui fait exactement ce calcul côté vitrine publique).
  const sectorBlueprint = getStorefrontBlueprint(industry);
  const activePreset = SECTOR_TO_PRESET[sectorBlueprint.sector];

  return (
    <div className="site-editor-page mx-auto flex w-full max-w-7xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="tokoo -eyebrow">Ma vitrine</p>
          <h1 className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Personnalisation du site</h1>
          <p className="mt-1 text-sm text-slate-500">Personnalisez l&apos;apparence et le contenu de votre site web.</p>
        </div>
        <div className="flex gap-2">
          {env.NEXT_PUBLIC_ROOT_DOMAIN !== "localhost:3000" && <a href={`https://${media.slug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`} target="_blank" rel="noopener noreferrer" className="adm-btn-secondary">Aperçu du site ↗</a>}
          <button type="submit" form="site-settings-form" className="adm-btn-primary">Enregistrer</button>
        </div>
      </div>

      <nav className="site-editor-tabs" aria-label="Sections de l&apos;éditeur">
        <a href="#theme" className="is-active">Thème</a>
        <a href="#content">Contenu</a>
        <a href="#sections">Sections</a>
        <a href="#settings">Paramètres</a>
      </nav>

      {error && (
        <p className="adm-alert-danger">{error}</p>
      )}
      {success && (
        <p className="adm-alert-success">{success}</p>
      )}

      <form id="site-settings-form" action={updateSiteAction} className="site-editor-main flex flex-col gap-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="currentLogoUrl" value={media.logoUrl ?? ""} />
        <input type="hidden" name="currentBannerUrl" value={media.bannerUrl ?? ""} />
        <input type="hidden" name="currentFaviconUrl" value={media.faviconUrl ?? ""} />
        <input type="hidden" name="currentSeoOgImageUrl" value={media.seoOgImageUrl ?? ""} />

        <div id="theme" className="site-editor-section-card"><div className="site-editor-section-heading"><span className="site-editor-section-dot">01</span><div><p className="text-sm font-bold">Identité visuelle</p><p className="text-xs text-slate-500">Logo, bannière et icône de votre vitrine.</p></div></div><ImageUploadField
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
        </div>

        <div id="content" className="site-editor-section-card flex flex-col gap-4 rounded-xl border border-navy-900/10 p-4">
          <div className="site-editor-section-heading"><span className="site-editor-section-dot">02</span><div><p className="text-sm font-bold">Contenu & référencement</p><p className="text-xs text-slate-500">Les informations qui apparaissent sur Google et au partage.</p></div></div>
          <div>
            <p className="text-sm font-medium">Référencement sur Google</p>
            <p className="text-xs text-slate-500">
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
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
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
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
            />
          </label>

          <ImageUploadField
            name="seoOg"
            label="Image de partage"
            currentUrl={media.seoOgImageUrl}
            helpText="Affichée quand votre page est partagée sur WhatsApp, Facebook, etc. Optionnel."
          />
        </div>

        <div className="site-editor-section-card flex flex-col gap-4 rounded-xl border border-navy-900/10 p-4">
          <div className="site-editor-section-heading"><span className="site-editor-section-dot">03</span><div><p className="text-sm font-bold">Réseaux sociaux</p><p className="text-xs text-slate-500">Ajoutez les profils visibles depuis votre vitrine.</p></div></div>
          <div>
            <p className="text-sm font-medium">Réseaux sociaux</p>
            <p className="text-xs text-slate-500">
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
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Instagram</span>
            <input
              type="url"
              name="socialInstagram"
              defaultValue={media.socialLinks.instagram ?? ""}
              placeholder="https://instagram.com/..."
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">TikTok</span>
            <input
              type="url"
              name="socialTiktok"
              defaultValue={media.socialLinks.tiktok ?? ""}
              placeholder="https://tiktok.com/@..."
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">LinkedIn</span>
            <input
              type="url"
              name="socialLinkedin"
              defaultValue={media.socialLinks.linkedin ?? ""}
              placeholder="https://linkedin.com/company/..."
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
            />
          </label>
        </div>

        <SubmitButton pendingLabel="Enregistrement...">Enregistrer</SubmitButton>
      </form>

      <aside className="site-editor-preview">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="tokoo -eyebrow">Aperçu</p>
            <h2 className="mt-1 font-jakarta text-base font-bold">Votre vitrine</h2>
          </div>
          {env.NEXT_PUBLIC_ROOT_DOMAIN !== "localhost:3000" && (
            <a href={`https://${media.slug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-primary hover:underline">Ouvrir le site ↗</a>
          )}
        </div>
        <div className="site-preview-frame">
          {env.NEXT_PUBLIC_ROOT_DOMAIN !== "localhost:3000" ? (
            <iframe title="Aperçu de votre site" src={`https://${media.slug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`} className="h-full w-full border-0" loading="lazy" />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center">
              <div>
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary-50 text-primary">✦</div>
                <p className="mt-3 font-jakarta text-sm font-bold">Votre aperçu apparaîtra ici</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Configurez votre domaine pour afficher votre vitrine directement dans cet espace.</p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Structure de page + personnalisation vitrine (Lot K, étendu par le chantier vitrine V2) */}
      <div id="sections" className="mt-2 flex flex-col gap-4 border-t border-navy-900/10 pt-6">
        <div>
          <div className="site-editor-section-heading mb-3"><span className="site-editor-section-dot">04</span><div><p className="text-sm font-bold">Structure de la page</p><p className="text-xs text-slate-500">Choisissez un modèle puis activez et réordonnez les sections.</p></div></div>
          <div className="site-sector-identity">
            <div className="site-sector-identity-mark" style={{ background: sectorBlueprint.defaultAccent.primary }}>✦</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-extrabold text-navy-900">Template actif : {sectorBlueprint.eyebrow}</p>
                <span className="site-sector-active-badge">Secteur de votre entreprise</span>
              </div>
              <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">La vitrine publique utilise automatiquement la composition, le vocabulaire et la direction artistique de ce secteur. Vos couleurs et vos contenus personnalisés prennent ensuite le relais.</p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Palette de base</span>
              <div className="mt-2 flex justify-end gap-1.5">
                <span className="site-color-chip" style={{ background: sectorBlueprint.defaultAccent.primary }} />
                <span className="site-color-chip" style={{ background: sectorBlueprint.defaultAccent.secondary }} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_PRESET_KEYS.filter((key) => key !== "default").map((preset) => {
              const isActive = preset === activePreset;
              return (
                <form key={preset} action={applyPresetAction} className={`site-template-card ${isActive ? "is-active" : ""}`}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="preset" value={preset} />
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold">{LANDING_PRESET_LABELS[preset]}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{LANDING_PRESET_DESCRIPTIONS[preset]}</p>
                    </div>
                    {isActive && <span className="site-template-current">Actif</span>}
                  </div>
                  <SubmitButton pendingLabel="Application…" className={`mt-4 w-full rounded-xl px-3 py-2.5 text-xs font-bold ${isActive ? "bg-navy-900 text-white" : "border border-navy-900/10 bg-white text-navy-900 hover:bg-slate-50"}`}>{isActive ? "Réappliquer ce modèle" : "Utiliser cette structure"}</SubmitButton>
                </form>
              );
            })}
          </div>

          <div className="mt-4 rounded-2xl border border-navy-900/[0.06] bg-white p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Composition recommandée</p>
                <p className="mt-1 text-sm font-semibold text-navy-900">{sectorBlueprint.heroTitle("votre entreprise")}</p>
                <p className="mt-1 text-xs text-slate-500">Sections prévues par le template {sectorBlueprint.eyebrow.toLowerCase()}.</p>
              </div>
              <a href="#section-list" className="text-xs font-bold text-primary hover:underline">Modifier les sections ↓</a>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {sectorBlueprint.sections.map((type) => (
                <span key={type} className="site-section-chip">{LANDING_SECTION_LABELS[type]}</span>
              ))}
            </div>
          </div>

          <form
            action={updateHeroAction}
            encType="multipart/form-data"
            className="grid gap-4 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 lg:grid-cols-2"
          >
            <input type="hidden" name="organizationId" value={organizationId} />
            <div className="lg:col-span-2"><p className="text-sm font-bold">Personnaliser votre première impression</p><p className="mt-1 text-xs text-slate-500">Modifiez le message principal, le bouton et le style sans toucher au code.</p></div>
            <label className="text-sm font-semibold">Titre principal<input name="heroTitle" defaultValue={landingConfig.heroTitle ?? ""} placeholder="Ex. Votre beauté, notre savoir-faire." className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal" /></label>
            <label className="text-sm font-semibold">Sous-titre<textarea name="heroSubtitle" defaultValue={landingConfig.heroSubtitle ?? ""} rows={2} placeholder="Une phrase qui explique votre valeur." className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal" /></label>
            <label className="text-sm font-semibold">Texte du bouton<input name="ctaLabel" defaultValue={landingConfig.ctaLabel ?? ""} placeholder="Nous contacter" className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal" /></label>
            <label className="text-sm font-semibold">Lien du bouton<input name="ctaUrl" defaultValue={landingConfig.ctaUrl ?? ""} placeholder="https://wa.me/..." className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal" /></label>

            <label className="text-sm font-semibold">Texte du second bouton (optionnel)<input name="secondaryCtaLabel" defaultValue={landingConfig.secondaryCtaLabel ?? ""} placeholder="Voir les promotions" className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal" /></label>
            <label className="text-sm font-semibold">Lien du second bouton<input name="secondaryCtaUrl" defaultValue={landingConfig.secondaryCtaUrl ?? ""} placeholder="/promotions" className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal" /></label>

            <label className="text-sm font-semibold">Ambiance visuelle<select name="visualStyle" defaultValue={landingConfig.visualStyle} className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal"><option value="soft">Douce</option><option value="clean">Épurée</option><option value="bold">Impactante</option></select></label>
            <label className="text-sm font-semibold">
              Disposition de l&apos;en-tête
              <select name="heroLayout" defaultValue={landingConfig.heroLayout ?? ""} className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal">
                <option value="">Automatique (selon vos photos)</option>
                {HERO_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>{HERO_LAYOUT_LABELS[layout]}</option>
                ))}
              </select>
            </label>

            <div className="lg:col-span-2">
              <ImageUploadField
                name="heroMedia"
                label="Photo de l'en-tête"
                currentUrl={landingConfig.heroMediaUrl}
                helpText="Utilisée par la disposition « texte + visuel côte à côte ». Sans photo, votre bannière ou la photo de votre premier produit peut être utilisée à la place."
              />
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold lg:col-span-2">
              <input type="checkbox" name="announcementEnabled" defaultChecked={landingConfig.announcementEnabled} className="h-4 w-4 rounded-sm border-navy-900/20" />
              Afficher une barre d&apos;annonce en haut de la page
            </label>
            <label className="text-sm font-semibold lg:col-span-2">
              Message de la barre d&apos;annonce
              <input
                name="announcement"
                defaultValue={landingConfig.announcement ?? ""}
                maxLength={160}
                placeholder="Ex. Livraison gratuite dès 15 000 FCFA d'achats"
                className="mt-2 w-full rounded-xl border border-navy-900/10 bg-white px-3 py-3 text-sm font-normal"
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-semibold lg:col-span-2">
              <input type="checkbox" name="showStats" defaultChecked={landingConfig.showStats} className="h-4 w-4 rounded-sm border-navy-900/20" />
              Afficher les chiffres clés (nombre de produits, catégories, avis…) — calculés automatiquement, jamais inventés
            </label>

            <div className="flex items-end lg:col-span-2"><SubmitButton pendingLabel="Enregistrement…" className="w-full rounded-xl bg-navy-900 px-4 py-3 text-sm font-semibold text-white sm:w-auto">Enregistrer la personnalisation</SubmitButton></div>
          </form>

          {/* Bande de confiance — jusqu'à 4 promesses. Sans personnalisation,
              les promesses par défaut du secteur s'appliquent (voir
              resolveStorefrontHighlights) ; ce formulaire permet de les
              remplacer ou de les retirer entièrement. */}
          <form action={updateHighlightsAction} className="mt-4 grid gap-4 rounded-2xl border border-navy-900/[0.06] bg-white p-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            <div>
              <p className="text-sm font-bold">Bande de confiance</p>
              <p className="mt-1 text-xs text-slate-500">
                {landingConfig.highlights === null
                  ? `Actuellement : les promesses par défaut de votre secteur (${sectorBlueprint.eyebrow.toLowerCase()}).`
                  : landingConfig.highlights.length === 0
                    ? "Actuellement : masquée (vous l'avez retirée)."
                    : "Personnalisée."}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: HIGHLIGHT_SLOTS }).map((_, index) => {
                const existing = landingConfig.highlights?.[index] ?? sectorBlueprint.highlights[index] ?? null;
                return (
                  <div key={index} className="flex flex-col gap-2 rounded-xl border border-navy-900/10 p-3">
                    <div className="flex items-center gap-2">
                      <HighlightIcon name={(existing?.icon as HighlightIconKey) ?? "sparkles"} className="h-4 w-4 text-violet-600" />
                      <select
                        name={`highlightIcon${index}`}
                        defaultValue={existing?.icon ?? "sparkles"}
                        className="flex-1 rounded-lg border border-navy-900/10 bg-white px-2 py-2 text-xs"
                      >
                        {HIGHLIGHT_ICON_KEYS.map((icon) => (
                          <option key={icon} value={icon}>{HIGHLIGHT_ICON_LABELS[icon]}</option>
                        ))}
                      </select>
                    </div>
                    <input
                      name={`highlightTitle${index}`}
                      defaultValue={landingConfig.highlights ? existing?.title ?? "" : ""}
                      placeholder={index === 0 ? "Ex. Livraison rapide" : "Titre (laisser vide pour ignorer)"}
                      maxLength={60}
                      className="rounded-lg border border-navy-900/10 px-3 py-2 text-sm"
                    />
                    <input
                      name={`highlightSubtitle${index}`}
                      defaultValue={landingConfig.highlights ? existing?.subtitle ?? "" : ""}
                      placeholder="Sous-titre (optionnel)"
                      maxLength={90}
                      className="rounded-lg border border-navy-900/10 px-3 py-2 text-sm"
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3">
              <SubmitButton pendingLabel="Enregistrement…" className="rounded-xl bg-navy-900 px-4 py-3 text-sm font-semibold text-white">Enregistrer la bande de confiance</SubmitButton>
            </div>
          </form>
          <form action={resetHighlightsAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <SubmitButton pendingLabel="…" className="mt-2 text-xs font-medium text-slate-500 underline">
              Revenir aux promesses par défaut de mon secteur
            </SubmitButton>
          </form>

          {/* Moyens de paiement — aucun n'est pré-coché : afficher un moyen
              non réellement accepté tromperait le client final. */}
          <form action={updatePaymentMethodsAction} className="mt-4 flex flex-col gap-3 rounded-2xl border border-navy-900/[0.06] bg-white p-4">
            <input type="hidden" name="organizationId" value={organizationId} />
            <div>
              <p className="text-sm font-bold">Moyens de paiement acceptés</p>
              <p className="mt-1 text-xs text-slate-500">Affichés en pied de page de votre site. Ne cochez que ce que vous acceptez réellement.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {PAYMENT_METHOD_KEYS.map((method) => (
                <label key={method} className="flex items-center gap-2 rounded-xl border border-navy-900/10 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    name={`payment_${method}`}
                    defaultChecked={(landingConfig.paymentMethods ?? []).includes(method as PaymentMethodKey)}
                    className="h-4 w-4 rounded-sm border-navy-900/20"
                  />
                  {PAYMENT_METHOD_LABELS[method]}
                </label>
              ))}
            </div>
            <SubmitButton pendingLabel="Enregistrement…" className="w-fit rounded-xl bg-navy-900 px-4 py-3 text-sm font-semibold text-white">Enregistrer les moyens de paiement</SubmitButton>
          </form>

          <h2 className="font-jakarta text-lg font-semibold">Sections de ma page</h2>
          <p className="mt-1 text-sm text-slate-500">
            Activez, désactivez et réordonnez les sections affichées sur votre page publique.
            {!landingConfig.isCustomized &&
              " Cette liste correspond aux sections par défaut de votre secteur d'activité — personnalisez-la librement, elle ne sera enregistrée qu'à votre première modification."}
          </p>
        </div>

        <ul id="section-list" className="flex flex-col gap-2">
          {landingConfig.sections.map((section, index) => (
            <li
              key={section.type}
              className="flex items-center gap-3 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] px-3 py-2"
            >
              <form action={toggleSectionAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="sectionType" value={section.type} />
                <input type="hidden" name="enabled" value={section.enabled ? "false" : "true"} />
                <SubmitButton
                  pendingLabel="…"
                  className={`flex h-6 w-6 items-center justify-center rounded-sm border text-xs font-bold ${
                    section.enabled ? "border-violet-400 bg-violet-600 text-white" : "border-navy-900/15 bg-white text-transparent"
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
                  className="rounded-xl border border-navy-900/10 px-2 py-1 text-xs disabled:opacity-30"
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
                  className="rounded-xl border border-navy-900/10 px-2 py-1 text-xs disabled:opacity-30"
                >
                  ↓
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">
          Le pied de page (coordonnées, mentions) est toujours affiché, quelle que soit cette configuration.
        </p>

        <div id="settings" className="site-editor-section-card"><div className="site-editor-section-heading"><span className="site-editor-section-dot">05</span><div><p className="text-sm font-bold">Paramètres de vitrine</p><p className="text-xs text-slate-500">Couleurs, typographie, témoignages et domaine.</p></div></div><form action={updateBrandingAction} className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <p className="text-sm font-medium">Couleurs et police</p>
          <div className="flex gap-6">
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Couleur principale</span>
              <input
                type="color"
                name="brandColorPrimary"
                defaultValue={landingConfig.brandColorPrimary ?? sectorBlueprint.defaultAccent.primary}
                className="h-10 w-16 rounded-xl border border-navy-900/10"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span>Couleur secondaire</span>
              <input
                type="color"
                name="brandColorSecondary"
                defaultValue={landingConfig.brandColorSecondary ?? sectorBlueprint.defaultAccent.secondary}
                className="h-10 w-16 rounded-xl border border-navy-900/10"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Police</span>
            <select
              name="fontChoice"
              defaultValue={landingConfig.fontChoice}
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
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

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-amber-950">Revenir au design de base</p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-amber-900/70">
                Annule les personnalisations de la vitrine et remet la structure, les couleurs, le hero, les boutons et les éléments par défaut de votre secteur. Votre catalogue, logo, bannière, SEO, domaine et autres données ne sont pas supprimés.
              </p>
            </div>
            <form action={resetSiteDesignAction} className="shrink-0">
              <input type="hidden" name="organizationId" value={organizationId} />
              <ResetSiteButton />
            </form>
          </div>
        </div>
      </div>

        {env.NEXT_PUBLIC_ROOT_DOMAIN === "localhost:3000" ? (
          <p className="adm-muted text-sm">
            Votre site sera accessible dès qu&apos;un nom de domaine sera configuré pour la plateforme (réglage
            technique, pas encore fait).
          </p>
        ) : (
          <a
            href={`https://${media.slug}.${env.NEXT_PUBLIC_ROOT_DOMAIN}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-brand hover:underline"
          >
            Voir mon site →
          </a>
        )}
      </div>

      {/* Lot K — Témoignages */}
      <div className="mt-4 flex flex-col gap-4 border-t border-navy-900/10 pt-6">
        <div>
          <h2 className="font-jakarta text-lg font-semibold">Témoignages</h2>
          <p className="mt-1 text-sm text-slate-500">
            Affichés dans la section « Témoignages » de votre page si elle est activée.
          </p>
        </div>

        <form action={createTestimonialAction} className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col gap-1 text-sm">
            Nom du client
            <input name="authorName" required className="rounded-xl border border-navy-900/10 px-4 py-3" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Témoignage
            <textarea name="content" required rows={2} className="rounded-xl border border-navy-900/10 px-4 py-3" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Note (optionnel)
            <select name="rating" defaultValue="" className="rounded-xl border border-navy-900/10 px-4 py-3">
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
                className="flex items-start justify-between gap-3 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] px-4 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {testimonial.authorName}
                    {testimonial.rating ? ` — ${testimonial.rating}★` : ""}
                  </p>
                  <p className="text-slate-500">{testimonial.content}</p>
                </div>
                <form action={deleteTestimonialAction}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="testimonialId" value={testimonial.id} />
                  <SubmitButton
                    pendingLabel="…"
                    className="shrink-0 rounded-xl bg-navy-900/5 px-2 py-1 text-xs font-medium text-navy-900 transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:opacity-60"
                  >
                    Retirer
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-4 border-t border-navy-900/10 pt-6">
        <div>
          <h2 className="font-jakarta text-lg font-semibold">Domaine personnalisé</h2>
          <p className="mt-1 text-sm text-slate-500">
            Demandez un nom de domaine pour votre boutique — traité manuellement par notre équipe (aucun registrar
            n&apos;est encore branché automatiquement).
          </p>
        </div>

        {tldPricing.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune extension n&apos;est proposée à la vente pour le moment.</p>
        ) : (
          <>
            <form action={requestDomainAction} className="flex flex-col gap-2">
              <input type="hidden" name="organizationId" value={organizationId} />
              <DomainSearchField organizationId={organizationId} />
              <p className="text-xs text-slate-500">
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
                    className="flex items-center justify-between rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] px-4 py-3 text-sm"
                  >
                    <span className="font-medium text-navy-900">{r.domainName}</span>
                    <span className="text-xs text-slate-500">{DOMAIN_STATUS_LABEL[r.status] ?? r.status}</span>
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
