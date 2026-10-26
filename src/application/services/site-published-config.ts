import { cache } from "react";
import type { LandingConfig } from "./landing-config-service";
import { getPublishedSite } from "./site-version-service";
import type { Page } from "@/domain/entities/site";
import {
  applyPublishedNavigation,
  applyPublishedSiteToLandingConfig,
  resolveHomeSeoOverride,
  type HomeSeoOverride,
  type NavEntry,
} from "./site-storefront-bridge";

/**
 * Point de branchement de la vitrine (C4). Mémoïsé par requête : le layout,
 * la page et `generateMetadata` partagent UNE seule lecture.
 * Règle de repli : toute erreur (base, version illisible) = comportement
 * d'avant. La vitrine publique ne doit jamais casser à cause du nouveau modèle.
 */
const loadPublished = cache(async (organizationId: string) => {
  try {
    return await getPublishedSite(organizationId);
  } catch (error) {
    console.error(`Version publiée du site illisible (${organizationId}), repli sur la config actuelle:`, error);
    return null;
  }
});

export async function resolveEffectiveLandingConfig(organizationId: string, base: LandingConfig): Promise<LandingConfig> {
  const published = await loadPublished(organizationId);
  return published ? applyPublishedSiteToLandingConfig(base, published.snapshot).config : base;
}

export async function getPublishedHomeSeo(organizationId: string): Promise<HomeSeoOverride | null> {
  const published = await loadPublished(organizationId);
  return published ? resolveHomeSeoOverride(published.snapshot) : null;
}

/** Menu effectif : `baseNav` + les entrées de la version publiée (voir applyPublishedNavigation). */
export async function resolveEffectiveNavigation<T extends NavEntry>(organizationId: string, baseNav: T[]): Promise<NavEntry[]> {
  const published = await loadPublished(organizationId);
  return published ? applyPublishedNavigation(baseNav, published.snapshot) : baseNav;
}

/** Accueil du SITE LIBRE publié (rendu par blocs). `null` pour un site par gabarit : l'accueil reste rendu par le gabarit sectoriel. */
export async function findPublishedFreeHome(organizationId: string): Promise<Page | null> {
  const published = await loadPublished(organizationId);
  if (published?.snapshot.mode !== "free") return null;
  return published.snapshot.pages.find((p) => p.kind === "home") ?? null;
}

/** Page supplémentaire PUBLIÉE par son slug (jamais le brouillon). `null` si absente. */
export async function findPublishedPage(organizationId: string, slug: string): Promise<Page | null> {
  const published = await loadPublished(organizationId);
  return published?.snapshot.pages.find((p) => p.kind === "page" && p.slug === slug) ?? null;
}

/** Pour le sitemap : pages supplémentaires indexables et accueil indexable ou non. */
export async function getPublishedSitemapInfo(organizationId: string): Promise<{ slugs: string[]; homeIndexable: boolean } | null> {
  const published = await loadPublished(organizationId);
  if (!published) return null;
  const pages = published.snapshot.pages;
  return {
    slugs: pages.filter((p) => p.kind === "page" && !p.seo.noindex && p.blocks.some((b) => b.visible)).map((p) => p.slug),
    homeIndexable: !pages.find((p) => p.kind === "home")?.seo.noindex,
  };
}
