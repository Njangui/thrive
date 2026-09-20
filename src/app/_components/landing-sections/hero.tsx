import Link from "next/link";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { toSafeHref } from "@/lib/safe-url";
import { TrackedCtaLink } from "../tracked-cta-link";
import { StorefrontImage } from "../storefront/storefront-image";
import { HighlightIcon } from "../storefront/storefront-icons";
import { Container } from "../storefront/storefront-ui";

/**
 * En-tête de la page d'accueil : sur-titre secteur, titre, sous-titre,
 * deux appels à l'action, visuel, puis la bande de confiance.
 *
 * Ce que ça remplace : un bloc qui affichait `tenant.industry` BRUT au
 * visiteur (« retail », « professional_services »), le nom de
 * l'entreprise en guise de titre, et un unique bouton WhatsApp. Les
 * libellés viennent maintenant du blueprint de secteur, et les cibles des
 * boutons sont résolues vers des pages qui existent réellement pour ce
 * tenant.
 */
function resolveCtaTarget(
  target: "catalog" | "booking" | "contact" | "promotions" | "services" | "gallery",
  site: StorefrontSite,
): string | null {
  const { capabilities } = site;
  switch (target) {
    case "catalog":
      return capabilities.hasProducts ? STOREFRONT_PATHS.catalog : null;
    case "booking":
      return capabilities.hasServices || capabilities.hasWhatsApp ? STOREFRONT_PATHS.booking : null;
    case "promotions":
      return capabilities.hasPromotions ? STOREFRONT_PATHS.promotions : null;
    case "services":
      return capabilities.hasServices ? STOREFRONT_PATHS.services : null;
    case "gallery":
      return capabilities.hasGallery ? STOREFRONT_PATHS.gallery : null;
    case "contact":
      return capabilities.hasContactDetails || capabilities.hasOpeningHours ? STOREFRONT_PATHS.contact : null;
    default:
      return null;
  }
}

export function HeroSection({ site, fallbackMediaUrl = null }: { site: StorefrontSite; fallbackMediaUrl?: string | null }) {
  const { tenant, config, blueprint, heroLayout, heroMediaUrl, whatsappHref, highlights } = site;

  const title = config.heroTitle?.trim() || blueprint.heroTitle(tenant.name);
  const subtitle = config.heroSubtitle?.trim() || tenant.description || blueprint.heroSubtitle(tenant.name);

  // Ordre de repli du CTA principal : lien saisi par le commerçant ->
  // page recommandée par son secteur -> WhatsApp -> page contact. On ne
  // rend jamais un bouton dont la destination n'existe pas.
  const primaryHref =
    toSafeHref(config.ctaUrl) ?? resolveCtaTarget(blueprint.primaryCtaTarget, site) ?? whatsappHref ?? null;
  const primaryLabel = config.ctaLabel?.trim() || blueprint.primaryCtaLabel;
  const primaryIsExternal = Boolean(primaryHref?.startsWith("http"));

  const secondaryHref =
    toSafeHref(config.secondaryCtaUrl) ?? resolveCtaTarget(blueprint.secondaryCtaTarget, site) ?? null;
  const secondaryLabel = config.secondaryCtaLabel?.trim() || blueprint.secondaryCtaLabel;

  const effectiveMediaUrl = heroMediaUrl ?? (site.sector === "restaurant" ? fallbackMediaUrl : null);
  const showMedia = heroLayout !== "centered" && Boolean(effectiveMediaUrl);

  if (site.sector === "restaurant") {
    return (
      <section className="restaurant-hero">
        <div className="restaurant-hero-media" aria-hidden>
          {effectiveMediaUrl ? (
            <StorefrontImage
              src={effectiveMediaUrl}
              alt=""
              sizes="100vw"
              priority
              fallbackLabel=""
            />
          ) : (
            <div className="restaurant-hero-fallback" />
          )}
        </div>
        <div className="restaurant-hero-overlay" aria-hidden />
        <Container className="restaurant-hero-content">
          <div className="restaurant-hero-copy">
            <p className="restaurant-kicker restaurant-kicker-dark">{blueprint.eyebrow} · {tenant.name}</p>
            <h1 className="font-display">{title}</h1>
            <p className="restaurant-hero-subtitle">{subtitle}</p>
            {(primaryHref || secondaryHref) && (
              <div className="restaurant-hero-actions">
                {primaryHref && (primaryIsExternal ? (
                  <TrackedCtaLink href={primaryHref} organizationId={tenant.organizationId} ctaId="hero_primary" target="_blank" rel="noopener noreferrer" className="restaurant-primary-btn">{primaryLabel} <span aria-hidden>→</span></TrackedCtaLink>
                ) : (
                  <Link href={primaryHref} className="restaurant-primary-btn">{primaryLabel} <span aria-hidden>→</span></Link>
                ))}
                {secondaryHref && secondaryHref !== primaryHref && (
                  <Link href={secondaryHref} className="restaurant-secondary-btn">{secondaryLabel} <span aria-hidden>→</span></Link>
                )}
              </div>
            )}
            {highlights.length > 0 && (
              <div className="restaurant-hero-highlights">
                {highlights.slice(0, 3).map((highlight) => (
                  <div key={highlight.title} className="restaurant-hero-highlight">
                    <span className="restaurant-highlight-icon"><HighlightIcon name={highlight.icon} className="h-4 w-4" /></span>
                    <span><strong>{highlight.title}</strong><small>{highlight.subtitle}</small></span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Container>
        {site.stats.find((stat) => stat.key === "rating") && (
          <div className="restaurant-hero-rating" aria-label="Avis clients">
            <span className="restaurant-rating-stars">★★★★★</span>
            <strong>{site.stats.find((stat) => stat.key === "rating")?.value}</strong>
            <small>{site.stats.find((stat) => stat.key === "rating")?.label}</small>
          </div>
        )}
      </section>
    );
  }

  const copy = (
    <div className={`flex flex-col gap-5 ${heroLayout === "centered" ? "mx-auto max-w-3xl text-center items-center" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">{blueprint.eyebrow}</p>
      <h1 className="font-display text-3xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">{title}</h1>
      <p className="max-w-xl text-sm leading-7 text-black/60 sm:text-base">{subtitle}</p>

      {(primaryHref || secondaryHref) && (
        <div className={`flex flex-wrap gap-3 ${heroLayout === "centered" ? "justify-center" : ""}`}>
          {primaryHref &&
            (primaryIsExternal ? (
              <TrackedCtaLink
                href={primaryHref}
                organizationId={tenant.organizationId}
                ctaId="hero_primary"
                target="_blank"
                rel="noopener noreferrer"
                className="sf-btn-primary inline-flex h-12 items-center px-6 text-sm"
              >
                {primaryLabel}
              </TrackedCtaLink>
            ) : (
              <Link href={primaryHref} className="sf-btn-primary inline-flex h-12 items-center px-6 text-sm">
                {primaryLabel}
              </Link>
            ))}
          {secondaryHref && secondaryHref !== primaryHref && (
            <Link href={secondaryHref} className="sf-btn-outline inline-flex h-12 items-center px-6 text-sm">
              {secondaryLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );

  return (
    <section className="sf-hero border-b border-black/[0.06]">
      <Container className="py-10 sm:py-16">
        {showMedia ? (
          <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
            {copy}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-brand bg-black/[0.03] lg:aspect-[5/4]">
              <StorefrontImage
                src={effectiveMediaUrl}
                alt=""
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority
                fallbackLabel=""
              />
            </div>
          </div>
        ) : (
          copy
        )}
      </Container>

      {highlights.length > 0 && (
        <div className="border-t border-black/[0.06] bg-[var(--brand-soft,rgba(0,0,0,.02))]">
          <Container className="grid gap-4 py-6 sm:grid-cols-2 lg:grid-cols-4">
            {highlights.map((highlight) => (
              <div key={highlight.title} className="flex items-start gap-3">
                <span className="sf-icon-box grid h-10 w-10 shrink-0 place-items-center rounded-brand text-brand">
                  <HighlightIcon name={highlight.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{highlight.title}</span>
                  {highlight.subtitle && <span className="block text-xs text-black/55">{highlight.subtitle}</span>}
                </span>
              </div>
            ))}
          </Container>
        </div>
      )}
    </section>
  );
}

/** Bande de chiffres RÉELS (voir getStorefrontStats) — rendue seulement si le service en a produit au moins trois. */
export function StatsBand({ site }: { site: StorefrontSite }) {
  if (site.stats.length === 0) return null;

  return (
    <section className="border-y border-black/[0.06] bg-white">
      <Container className="grid grid-cols-2 gap-6 py-8 lg:grid-cols-4">
        {site.stats.map((stat) => (
          <div key={stat.key} className="text-center">
            <p className="font-display text-2xl font-extrabold text-brand sm:text-3xl">{stat.value}</p>
            <p className="mt-1 text-xs text-black/55 sm:text-sm">{stat.label}</p>
          </div>
        ))}
      </Container>
    </section>
  );
}
