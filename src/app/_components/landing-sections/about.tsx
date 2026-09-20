import Link from "next/link";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { StorefrontImage } from "../storefront/storefront-image";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/** Section « À propos » : variante restaurant proche de la maquette (visuel à gauche, histoire à droite). */
export function AboutSection({ site, compact = false }: { site: StorefrontSite; compact?: boolean }) {
  const { tenant, blueprint } = site;
  if (!tenant.description) return null;

  const text = compact ? tenant.description.slice(0, 420) : tenant.description;
  const truncated = compact && tenant.description.length > 420;

  if (site.sector === "restaurant") {
    const media = site.heroMediaUrl ?? tenant.bannerUrl;
    return (
      <Section className="restaurant-story-section">
        <div className="grid items-center gap-8 lg:grid-cols-[1.02fr_.98fr] lg:gap-14">
          <div className="restaurant-story-media relative aspect-[4/3] overflow-hidden rounded-[1.25rem]">
            <StorefrontImage src={media} alt={tenant.name} priority sizes="(min-width: 1024px) 48vw, 100vw" fallbackLabel="Notre maison" />
            <div className="restaurant-story-badge" aria-hidden>Le goût du partage</div>
          </div>
          <div>
            <p className="restaurant-kicker">À PROPOS</p>
            <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
              {sectionHeading(blueprint, "about", "Notre maison")}
            </h2>
            <p className="mt-4 whitespace-pre-line text-sm leading-7 text-black/60 sm:text-base">{text}{truncated ? "…" : ""}</p>
            {truncated && (
              <Link href={STOREFRONT_PATHS.about} className="restaurant-outline-btn mt-6 inline-flex items-center">En savoir plus <span aria-hidden>→</span></Link>
            )}
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="restaurant-story-point"><span>✦</span><strong>Cuisine authentique</strong></div>
              <div className="restaurant-story-point"><span>✦</span><strong>Cadre chaleureux</strong></div>
              <div className="restaurant-story-point"><span>✦</span><strong>Service attentionné</strong></div>
            </div>
          </div>
        </div>
      </Section>
    );
  }

  return (
    <Section tone="muted">
      <SectionHeading title={sectionHeading(blueprint, "about", `À propos de ${tenant.name}`)} />
      <div className="max-w-3xl">
        <p className="whitespace-pre-line text-base leading-8 text-black/70">
          {text}
          {truncated ? "…" : ""}
        </p>
        {truncated && (
          <Link href={STOREFRONT_PATHS.about} className="mt-4 inline-flex text-sm font-semibold text-brand hover:underline">
            En savoir plus
          </Link>
        )}
      </div>
    </Section>
  );
}
