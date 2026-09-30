import Link from "next/link";
import type { ReactNode } from "react";
import { formatPrice } from "@/lib/format";
import { TrackedCtaLink } from "../tracked-cta-link";
import { IconArrowRight, IconStar } from "../storefront/storefront-icons";
export { formatAverage } from "../sector-shared/rating";
import type { CtaAction } from "./restaurant-model";

/**
 * Petits éléments partagés par les sections du template restaurant.
 * Rien ici ne décide de quoi afficher (c'est le rôle de `restaurant-model.ts`) :
 * ce sont uniquement des briques de dessin.
 */

export type ButtonVariant = "light" | "ghost" | "accent" | "outline";

/**
 * Bouton d'appel à l'action. Trois rendus selon la destination : lien interne
 * (`next/link`), lien externe (nouvel onglet + clic journalisé, comme le hero
 * générique), lien de protocole (`tel:`, `mailto:`).
 */
export function CtaLink({
  action,
  variant,
  ctaId,
  organizationId,
}: {
  action: CtaAction;
  variant: ButtonVariant;
  /** Identifiant du clic dans les statistiques du commerçant. */
  ctaId: string;
  organizationId: string;
}) {
  const className = `rl-btn rl-btn--${variant}`;
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

/** Titre de section : h2, phrase d'appui optionnelle, lien d'action optionnel aligné à droite. */
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
  /** « Exemple » sur du contenu fictif : toujours visible, jamais un détail. */
  badge?: string | null;
}) {
  return (
    <header className="rl-head">
      <div className="rl-head__text">
        <h2 id={id} className="rl-h2">
          {title}
          {badge && <span className="rl-badge rl-badge--demo">{badge}</span>}
        </h2>
        {subtitle && <p className="rl-head__sub">{subtitle}</p>}
      </div>
      {action && (
        <Link href={action.href} className="rl-link">
          {action.label}
          <IconArrowRight className="rl-link__icon" />
        </Link>
      )}
    </header>
  );
}

/**
 * Prix. Le prix barré est lisible par un lecteur d'écran (« au lieu de »)
 * plutôt que d'être un simple effet visuel qui lirait deux nombres de suite.
 */
export function Price({ amount, compare }: { amount: number; compare?: number | null }) {
  return (
    <span className="rl-price">
      {compare != null && (
        <s className="rl-price__old">
          <span className="rl-sr">Au lieu de </span>
          {formatPrice(compare)}
        </s>
      )}
      <span>{formatPrice(amount)}</span>
    </span>
  );
}

/** Ligne de carte : nom, pointillés, valeur — le geste typographique d'une vraie carte de restaurant. */
export function MenuLine({ label, value, as: Tag = "span" }: { label: ReactNode; value?: ReactNode; as?: "span" | "div" }) {
  const hasValue = value !== null && value !== undefined && value !== "";
  return (
    <Tag className="rl-line">
      <span className="rl-line__label">{label}</span>
      {/* Des pointillés qui ne mènent à aucune valeur n'ont aucun sens : ils disparaissent avec elle. */}
      {hasValue && (
        <>
          <span className="rl-line__dots" aria-hidden="true" />
          <span className="rl-line__value">{value}</span>
        </>
      )}
    </Tag>
  );
}

/** Étoiles pleines/vides + libellé texte pour les lecteurs d'écran. */
export function Stars({ rating, label }: { rating: number; label: string }) {
  const rounded = Math.round(rating);
  return (
    <span className="rl-stars" role="img" aria-label={label}>
      {[1, 2, 3, 4, 5].map((i) => (
        <IconStar key={i} className={i <= rounded ? "rl-stars__on" : "rl-stars__off"} />
      ))}
    </span>
  );
}

