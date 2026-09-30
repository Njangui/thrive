import Link from "next/link";
import type { ReactNode } from "react";
import { formatPrice } from "@/lib/format";
import { TrackedCtaLink } from "../tracked-cta-link";
import { IconArrowRight, IconStar } from "../storefront/storefront-icons";
import type { CtaAction } from "./services-model";

/**
 * Briques partagées par les sections du template prestataire de service.
 * Volontairement indépendantes de `restaurant/restaurant-ui.tsx` (mêmes
 * formes, classes CSS `ps-*` propres à ce template) : chaque template
 * sectoriel reste un module autonome, comme c'était déjà le cas avant ce
 * chantier (`.rest-*`, `.pro-*`, `.re-*`...).
 */

export type ButtonVariant = "light" | "ghost" | "accent" | "outline";

export function CtaLink({
  action,
  variant,
  ctaId,
  organizationId,
}: {
  action: CtaAction;
  variant: ButtonVariant;
  ctaId: string;
  organizationId: string;
}) {
  const className = `ps-btn ps-btn--${variant}`;
  if (action.kind === "external") {
    return (
      <TrackedCtaLink href={action.href} organizationId={organizationId} ctaId={ctaId} target="_blank" rel="noopener noreferrer" className={className}>
        {action.label}
      </TrackedCtaLink>
    );
  }
  if (action.kind === "protocol") {
    return (
      <a href={action.href} className={className}>
        {action.label}
      </a>
    );
  }
  return (
    <Link href={action.href} className={className}>
      {action.label}
    </Link>
  );
}

export function SectionHead({
  id,
  title,
  subtitle,
  action,
  badge,
}: {
  id: string;
  title: string;
  subtitle?: string | null;
  action?: { label: string; href: string } | null;
  badge?: string | null;
}) {
  return (
    <header className="ps-head">
      <div className="ps-head__text">
        <h2 id={id} className="ps-h2">
          {title}
          {badge && <span className="ps-badge ps-badge--demo">{badge}</span>}
        </h2>
        {subtitle && <p className="ps-head__sub">{subtitle}</p>}
      </div>
      {action && (
        <Link href={action.href} className="ps-link">
          {action.label}
          <IconArrowRight className="ps-link__icon" />
        </Link>
      )}
    </header>
  );
}

export function Price({ amount }: { amount: number }) {
  return <span className="ps-price">{formatPrice(amount)}</span>;
}

/** Ligne à pointillés — nom, pointillés, valeur — reprise pour les services et les horaires. */
export function MenuLine({ label, value }: { label: ReactNode; value?: ReactNode }) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <span className="ps-line">
      <span className="ps-line__label">{label}</span>
      {hasValue && (
        <>
          <span className="ps-line__dots" aria-hidden="true" />
          <span className="ps-line__value">{value}</span>
        </>
      )}
    </span>
  );
}

export function Stars({ rating, label }: { rating: number; label: string }) {
  const rounded = Math.round(rating);
  return (
    <span className="ps-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} className={i <= rounded ? "ps-stars__on" : "ps-stars__off"} />
      ))}
    </span>
  );
}

export { formatAverage } from "../sector-shared/rating";
