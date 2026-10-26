import { RESERVED_PAGE_SLUGS, type SiteSnapshot, type Page } from "@/domain/entities/site";

/**
 * Garde-fou SEO à la publication (C4, livrable E) — PUR, sans réseau.
 * Il vérifie ce qui est vérifiable sur l'instantané. Ce qui dépend du rendu
 * ou du réseau n'est PAS vérifié ici (voir « Non couvert » dans
 * docs/agents/c4-site-pages.md) : canonical, JSON-LD, sitemap/robots,
 * poids réel des images. Aucune promesse de classement.
 *
 * Erreurs critiques = publication bloquée ; avertissements = affichés, non bloquants.
 * La table SEVERITY est le seul endroit à modifier pour durcir ou assouplir une règle.
 */

export type LintSeverity = "error" | "warning";
export interface LintIssue { severity: LintSeverity; code: LintCode; pageId?: string; message: string }

const SEVERITY = {
  HOME_NOINDEX: "error",
  EMPTY_INDEXABLE_PAGE: "error",
  TITLE_LENGTH: "warning",
  DESCRIPTION_MISSING: "warning",
  DESCRIPTION_LENGTH: "warning",
  DUPLICATE_TITLE: "warning",
  DUPLICATE_DESCRIPTION: "warning",
  MISSING_ALT: "warning",
  MISSING_OG_IMAGE: "warning",
  ORPHAN_PAGE: "warning",
  BROKEN_INTERNAL_LINK: "warning",
  MULTIPLE_MAIN_HEADINGS: "warning",
  NO_MAIN_HEADING: "warning",
} as const satisfies Record<string, LintSeverity>;
export type LintCode = keyof typeof SEVERITY;

export const TITLE_RANGE = { min: 15, max: 60 } as const;
export const DESCRIPTION_RANGE = { min: 70, max: 160 } as const;

export interface LintResult { issues: LintIssue[]; errors: LintIssue[]; warnings: LintIssue[]; canPublish: boolean }

const effectiveTitle = (p: Page) => (p.seo.title ?? p.title).trim();
const effectiveDescription = (p: Page) => (p.seo.description ?? "").trim();
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ");

/** Tous les liens d'un bloc : `ctaUrl`/`secondaryCtaUrl` (hero du gabarit) et tout `href` imbriqué (blocs riches). */
function collectLinks(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectLinks(v, out));
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      if ((key === "ctaUrl" || key === "secondaryCtaUrl" || key === "href") && typeof v === "string") out.push(v);
      else collectLinks(v, out);
    }
  }
  return out;
}

export function lintSiteSnapshot(site: SiteSnapshot): LintResult {
  const issues: LintIssue[] = [];
  const add = (code: LintCode, message: string, pageId?: string) => issues.push({ severity: SEVERITY[code], code, message, pageId });

  const slugs = new Set(site.pages.map((p) => p.slug));
  const indexable = site.pages.filter((p) => !p.seo.noindex);

  for (const page of site.pages) {
    const label = `Page « ${page.title} »`;

    if (page.kind === "home" && page.seo.noindex) add("HOME_NOINDEX", `${label} : l'accueil est en « noindex », Google ne l'indexera pas.`, page.id);
    if (!page.seo.noindex && !page.blocks.some((b) => b.visible)) add("EMPTY_INDEXABLE_PAGE", `${label} : aucune section visible sur une page indexable.`, page.id);

    const title = effectiveTitle(page);
    if (title.length < TITLE_RANGE.min || title.length > TITLE_RANGE.max) {
      add("TITLE_LENGTH", `${label} : titre de ${title.length} caractères (recommandé ${TITLE_RANGE.min}–${TITLE_RANGE.max}).`, page.id);
    }
    const description = effectiveDescription(page);
    if (!description) add("DESCRIPTION_MISSING", `${label} : méta-description manquante.`, page.id);
    else if (description.length < DESCRIPTION_RANGE.min || description.length > DESCRIPTION_RANGE.max) {
      add("DESCRIPTION_LENGTH", `${label} : description de ${description.length} caractères (recommandé ${DESCRIPTION_RANGE.min}–${DESCRIPTION_RANGE.max}).`, page.id);
    }

    if (site.mode === "free") {
      const heroes = page.blocks.filter((b) => b.visible && b.type === "rich_hero").length;
      if (heroes > 1) add("MULTIPLE_MAIN_HEADINGS", `${label} : ${heroes} en-têtes (hero) visibles, une page ne doit avoir qu'un titre principal.`, page.id);
      if (heroes === 0 && page.kind === "home") add("NO_MAIN_HEADING", `${label} : l'accueil n'a pas d'en-tête (hero) visible, donc pas de titre principal.`, page.id);
    }
    for (const b of page.blocks) {
      if (b.visible && b.type === "rich_hero" && b.props.mediaUrl && !b.props.mediaAlt) {
        add("MISSING_ALT", `${label} : le visuel de l'en-tête n'a pas de texte alternatif.`, page.id);
      }
      if (b.visible && b.type === "hero" && b.props.mediaUrl && !b.props.mediaAlt) {
        add("MISSING_ALT", `${label} : le visuel du hero n'a pas de texte alternatif.`, page.id);
      }
    }
    if (page.kind === "home" && !page.seo.ogImageUrl && !page.seo.noindex) {
      add("MISSING_OG_IMAGE", `${label} : pas d'image de partage (réseaux sociaux, WhatsApp).`, page.id);
    }
  }

  // Unicité (pages indexables uniquement)
  const dupes = (pick: (p: Page) => string, code: "DUPLICATE_TITLE" | "DUPLICATE_DESCRIPTION", what: string) => {
    const seen = new Map<string, Page>();
    for (const p of indexable) {
      const value = norm(pick(p));
      if (!value) continue;
      const first = seen.get(value);
      if (first) add(code, `${what} identique sur « ${first.title} » et « ${p.title} ».`, p.id);
      else seen.set(value, p);
    }
  };
  dupes(effectiveTitle, "DUPLICATE_TITLE", "Titre");
  dupes(effectiveDescription, "DUPLICATE_DESCRIPTION", "Description");

  // Liens internes : pages orphelines et liens vers un chemin inconnu
  const linkedPageIds = new Set(site.navigation.flatMap((n) => (n.kind === "page" ? [n.pageId] : [])));
  const internalPaths: { href: string; from: string; pageId?: string }[] = [];
  site.navigation.forEach((n) => { if (n.kind === "link") internalPaths.push({ href: n.href, from: "la navigation" }); });
  for (const page of site.pages) {
    for (const b of page.blocks) {
      for (const href of collectLinks(b.props)) internalPaths.push({ href, from: `la page « ${page.title} »`, pageId: page.id });
    }
  }
  const knownFirstSegments = new Set<string>([...RESERVED_PAGE_SLUGS, ...[...slugs].filter(Boolean)]);
  for (const { href, from, pageId } of internalPaths) {
    if (!href.startsWith("/")) continue;
    const first = href.split(/[?#]/)[0]!.split("/").filter(Boolean)[0];
    if (first) {
      const target = site.pages.find((p) => p.slug === first);
      if (target) linkedPageIds.add(target.id);
    }
    if (first && !knownFirstSegments.has(first)) add("BROKEN_INTERNAL_LINK", `Lien « ${href} » dans ${from} : aucune page ni route ne correspond.`, pageId);
  }
  for (const page of indexable) {
    if (page.kind !== "home" && !linkedPageIds.has(page.id)) add("ORPHAN_PAGE", `Page « ${page.title} » : aucun lien interne n'y mène.`, page.id);
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { issues, errors, warnings, canPublish: errors.length === 0 };
}
