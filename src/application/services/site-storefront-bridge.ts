import type { LandingConfig } from "./landing-config-service";
import { isRichBlockType, type Page, type SiteSnapshot } from "@/domain/entities/site";

/**
 * Pont « version publiée du site » -> vitrine EXISTANTE (C4).
 *
 * Choix de sécurité : on ne réécrit pas le rendu. La version publiée est
 * convertie en `LandingConfig` — le contrat que consomment déjà
 * `getStorefrontSite` et tous les composants — donc les composants actuels
 * rendent le résultat. Un tenant SANS version publiée garde exactement sa
 * config d'avant (aucun changement). Fonctions pures, sans base.
 *
 * Limites actuelles (voir docs/agents/c4-site-pages.md) :
 *  - le schéma n'accepte sur l'accueil que des sections que le moteur sait rendre ;
 *    le bloc `text` n'existe que sur les pages supplémentaires ;
 *  - `mediaAlt` du hero n'est lu que par le hero générique (HeroSection) ; les gabarits sectoriels
 *    ont leur propre hero : à vérifier gabarit par gabarit ;
 *  - seule la page d'accueil est pilotée ; la navigation reste celle du produit.
 */

export interface BridgeResult {
  config: LandingConfig;
  /** Blocs présents dans la version publiée mais pas encore rendables (ex. `text`). */
  unrenderedBlocks: number;
}

export function applyPublishedSiteToLandingConfig(base: LandingConfig, site: SiteSnapshot): BridgeResult {
  const home = site.pages.find((p) => p.kind === "home");
  if (!home) return { config: base, unrenderedBlocks: 0 };

  let unrenderedBlocks = 0;
  const sections: LandingConfig["sections"] = [];
  for (const block of home.blocks) {
    // Site libre : l'accueil est rendu par le moteur de blocs, pas par les sections du gabarit.
    if (site.mode === "free") break;
    if (block.type === "text" || isRichBlockType(block.type)) {
      unrenderedBlocks++;
      continue;
    }
    sections.push({ type: block.type as LandingConfig["sections"][number]["type"], enabled: block.visible, order: sections.length });
  }

  const hero = home.blocks.find((b) => b.type === "hero");
  const heroProps = hero && hero.type === "hero" ? hero.props : {};

  return {
    unrenderedBlocks,
    config: {
      ...base, // conserve organizationId, paymentMethods, showStats…
      sections: site.mode === "free" ? base.sections : sections,
      brandColorPrimary: site.theme.brandColorPrimary,
      brandColorSecondary: site.theme.brandColorSecondary,
      fontChoice: site.theme.fontChoice,
      visualStyle: site.theme.visualStyle,
      heroTitle: heroProps.title ?? null,
      heroSubtitle: heroProps.subtitle ?? null,
      ctaLabel: heroProps.ctaLabel ?? null,
      ctaUrl: heroProps.ctaUrl ?? null,
      secondaryCtaLabel: heroProps.secondaryCtaLabel ?? null,
      secondaryCtaUrl: heroProps.secondaryCtaUrl ?? null,
      heroLayout: heroProps.layout ?? null,
      heroMediaUrl: heroProps.mediaUrl ?? null,
      heroMediaAlt: heroProps.mediaAlt ?? null,
      announcement: site.announcement?.text ?? null,
      announcementEnabled: site.announcement?.enabled ?? true,
      highlights: site.highlights,
      isCustomized: true,
    },
  };
}

export interface HomeSeoOverride {
  title?: string;
  description?: string;
  ogImageUrl?: string;
  noindex: boolean;
}

/** SEO de l'accueil tel que publié. Un champ absent = on garde le SEO actuel de l'organisation. */
export function resolveHomeSeoOverride(site: SiteSnapshot): HomeSeoOverride {
  const seo = site.pages.find((p) => p.kind === "home")?.seo ?? {};
  return {
    title: seo.title || undefined,
    description: seo.description || undefined,
    ogImageUrl: seo.ogImageUrl || undefined,
    noindex: seo.noindex === true,
  };
}

export interface NavEntry { key: string; label: string; href: string }

/** Chemin public d'une page : `/` pour l'accueil, `/<slug>` sinon. */
export const pagePath = (page: Pick<Page, "kind" | "slug">): string => (page.kind === "home" ? "/" : `/${page.slug}`);

/**
 * Menu publié : les entrées définies dans le site s'AJOUTENT au menu du produit
 * (Accueil, catalogue, services…, qui dépendent des données du tenant) ; « Contact »
 * reste en dernier. Elles ne le remplacent jamais : créer une page « dans le menu »
 * ne doit pas faire disparaître Accueil ou Produits. Une entrée vers une page disparue
 * est ignorée plutôt que de produire un lien mort.
 */
export function applyPublishedNavigation(baseNav: NavEntry[], site: SiteSnapshot): NavEntry[] {
  const added: NavEntry[] = [];
  site.navigation.forEach((item, index) => {
    if (item.kind === "link") {
      added.push({ key: `link-${index}`, label: item.label, href: item.href });
      return;
    }
    const page = site.pages.find((p) => p.id === item.pageId);
    if (page) added.push({ key: `page-${page.id}`, label: item.label, href: pagePath(page) });
  });
  if (added.length === 0) return baseNav;
  const contact = baseNav.filter((entry) => entry.key === "contact");
  return [...baseNav.filter((entry) => entry.key !== "contact"), ...added, ...contact];
}
