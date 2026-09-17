"use client";

import { trackClickAction } from "../track-click-action";
import { IconWhatsapp } from "./storefront-icons";

/**
 * Bouton WhatsApp flottant. Sur le marché visé, WhatsApp n'est pas un
 * canal secondaire : c'est là que la commande se conclut. Le rendre
 * atteignable depuis n'importe quel écran de n'importe quelle page —
 * plutôt qu'uniquement depuis l'en-tête d'accueil — est la seule
 * modification de cette vitrine qui touche directement le taux de
 * conversion du commerçant.
 *
 * Le clic est journalisé en « fire and forget » (même pattern que
 * `TrackedCtaLink`) : la navigation vers WhatsApp n'attend jamais
 * l'enregistrement, et un échec de journalisation n'empêche jamais le
 * client d'écrire.
 */
export function WhatsappFab({
  href,
  organizationId,
  label = "Nous écrire sur WhatsApp",
}: {
  href: string;
  organizationId: string;
  label?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      onClick={() => {
        void trackClickAction(organizationId, "whatsapp_fab");
      }}
      className="sf-fab fixed bottom-5 right-4 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-leaf text-white shadow-lg transition-transform hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:bottom-6 sm:right-6"
    >
      <IconWhatsapp className="h-7 w-7" />
    </a>
  );
}
