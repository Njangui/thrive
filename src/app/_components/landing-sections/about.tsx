import Link from "next/link";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/** Rend `null` sans description — jamais un encart vide. */
export function AboutSection({ site, compact = false }: { site: StorefrontSite; compact?: boolean }) {
  const { tenant, blueprint } = site;
  if (!tenant.description) return null;

  const text = compact ? tenant.description.slice(0, 420) : tenant.description;
  const truncated = compact && tenant.description.length > 420;

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
