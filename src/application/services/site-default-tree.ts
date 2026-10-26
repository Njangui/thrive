import {
  SITE_SNAPSHOT_SCHEMA_VERSION,
  isSafeLink,
  type Block,
  type BlockType,
  type SiteSnapshot,
} from "@/domain/entities/site";
import type { LANDING_SECTION_TYPES, LandingHighlight } from "@/domain/entities/landing";

/**
 * Génère l'arbre de pages par défaut d'un tenant EXISTANT à partir de sa
 * configuration actuelle (`getLandingConfig`) — fonction pure, sans base.
 * Compatibilité : mêmes sections, même ordre, mêmes visibilités ; les
 * sections désactivées restent présentes mais `visible: false` (le
 * commerçant peut les réactiver, rien n'est perdu).
 *
 * Périmètre de cette première étape : l'ACCUEIL. Les autres routes de la
 * vitrine (produits, services, FAQ, contact…) restent des routes système
 * tant que le moteur de rendu n'est pas branché ; elles ne sont pas des
 * « pages » éditables.
 */
export interface DefaultSiteInput {
  sections: { type: (typeof LANDING_SECTION_TYPES)[number]; enabled: boolean; order: number }[];
  brandColorPrimary: string | null;
  brandColorSecondary: string | null;
  fontChoice: "modern" | "classic" | "friendly";
  visualStyle: "soft" | "clean" | "bold";
  heroTitle: string | null;
  heroSubtitle: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  secondaryCtaLabel: string | null;
  secondaryCtaUrl?: string | null;
  heroLayout: "split" | "centered" | "banner" | null;
  heroMediaUrl: string | null;
  heroMediaAlt?: string | null;
  announcement: string | null;
  announcementEnabled: boolean;
  highlights: LandingHighlight[] | null;
  /** Titre de l'accueil (nom de l'entreprise). */
  organizationName: string;
  /** SEO ACTUEL de l'accueil (`resolveOrganizationSeo`) : repris tel quel pour que le garde-fou et le rendu parlent de la même chose. */
  homeSeo?: { title?: string | null; description?: string | null; ogImageUrl?: string | null };
}

/** Retire les clés `undefined` : le schéma est strict et le JSON ne les porte pas. */
function compact<T extends Record<string, unknown>>(props: T): T {
  return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}

function httpsOrUndefined(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function buildDefaultSiteSnapshot(input: DefaultSiteInput): SiteSnapshot {
  const ordered = [...input.sections].sort((a, b) => a.order - b.order);

  const blocks: Block[] = ordered.map((section) => {
    const id = `blk-${section.type}`;
    const visible = section.enabled;
    if (section.type === "hero") {
      return {
        id,
        type: "hero",
        visible,
        props: compact({
          title: input.heroTitle ?? undefined,
          subtitle: input.heroSubtitle ?? undefined,
          ctaLabel: input.ctaLabel ?? undefined,
          ctaUrl: input.ctaUrl && isSafeLink(input.ctaUrl) ? input.ctaUrl : undefined,
          secondaryCtaLabel: input.secondaryCtaLabel ?? undefined,
          secondaryCtaUrl: input.secondaryCtaUrl && isSafeLink(input.secondaryCtaUrl) ? input.secondaryCtaUrl : undefined,
          layout: input.heroLayout ?? undefined,
          mediaUrl: httpsOrUndefined(input.heroMediaUrl),
          mediaAlt: input.heroMediaAlt?.slice(0, 125) || undefined,
        }),
      };
    }
    // Les autres sections tirent leur contenu des données du tenant : props vides = rendu actuel.
    return { id, type: section.type as Exclude<BlockType, "hero" | "text">, visible, props: {} } as Block;
  });

  return {
    schemaVersion: SITE_SNAPSHOT_SCHEMA_VERSION,
    theme: {
      brandColorPrimary: input.brandColorPrimary,
      brandColorSecondary: input.brandColorSecondary,
      fontChoice: input.fontChoice,
      visualStyle: input.visualStyle,
    },
    navigation: [],
    announcement: input.announcement ? { text: input.announcement.slice(0, 200), enabled: input.announcementEnabled } : null,
    highlights: input.highlights,
    pages: [
      {
        id: "page-home",
        kind: "home",
        slug: "",
        title: input.organizationName.slice(0, 120) || "Accueil",
        seo: compact({
          title: input.homeSeo?.title?.slice(0, 120) || undefined,
          description: input.homeSeo?.description?.slice(0, 320) || undefined,
          ogImageUrl: httpsOrUndefined(input.homeSeo?.ogImageUrl ?? null),
        }),
        blocks,
      },
    ],
  };
}
