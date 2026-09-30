import Link from "next/link";
import type { ReactNode } from "react";
import { TrackedCtaLink } from "../../tracked-cta-link";
import type { RetailCta } from "../model";

/**
 * Bouton/lien d'appel à l'action de la landing. Un lien externe (WhatsApp,
 * URL saisie par le commerçant) s'ouvre dans un nouvel onglet et journalise
 * `cta_click` ; un lien interne reste un `<Link>` de navigation client — le
 * même partage que `landing-sections/hero.tsx`, pour que l'analytique ne
 * change pas selon le mode d'affichage de la page d'accueil.
 */
export function CtaLink({
  cta,
  organizationId,
  className,
  children,
}: {
  cta: RetailCta;
  organizationId: string;
  className?: string;
  children?: ReactNode;
}) {
  if (cta.external) {
    return (
      <TrackedCtaLink
        href={cta.href}
        organizationId={organizationId}
        ctaId={cta.trackingId ?? "retail_cta"}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children ?? cta.label}
      </TrackedCtaLink>
    );
  }
  return (
    <Link href={cta.href} className={className}>
      {children ?? cta.label}
    </Link>
  );
}
