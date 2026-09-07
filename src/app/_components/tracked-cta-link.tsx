"use client";

import type { ReactNode } from "react";
import { trackClickAction } from "./track-click-action";

/**
 * Lien CTA (WhatsApp/Contact) qui journalise le clic avant de naviguer
 * (Lot H, Partie 2, master prompt §55). Composant client minimal, pas de
 * tracker JS tiers (cahier explicite) — juste un `onClick` qui appelle la
 * Server Action dédiée.
 *
 * `target="_blank"` laisse systématiquement la page courante ouverte le
 * temps que l'appel serveur parte : on ne bloque JAMAIS la navigation en
 * l'attendant (pas de `preventDefault`, pas d'`await` dans le handler —
 * fire-and-forget assumé ici, contrairement aux appels serveur de
 * `trackEvent` ailleurs dans ce lot qui sont `await`és, voir
 * analytics-service.ts pour la distinction).
 */
export function TrackedCtaLink({
  href,
  organizationId,
  ctaId,
  className,
  target,
  rel,
  children,
}: {
  href: string;
  organizationId: string;
  ctaId: string;
  className?: string;
  target?: string;
  rel?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      className={className}
      onClick={() => {
        void trackClickAction(organizationId, ctaId);
      }}
    >
      {children}
    </a>
  );
}
