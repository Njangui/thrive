import type { JSX, SVGProps } from "react";
import type { StorefrontIconKey } from "@/application/config/storefront-blueprint";
import type { PaymentMethodKey } from "@/domain/entities/landing";

/**
 * Jeu d'icônes de la VITRINE PUBLIQUE — distinct de `app-icons.tsx`, qui
 * sert le chrome de l'application authentifiée (dashboard/admin). Les
 * deux jeux ne partagent volontairement rien : ce sont deux marques
 * différentes (celle du commerçant vs celle de Flexco), et fusionner les
 * deux fichiers rendrait impossible de faire évoluer l'un sans risquer
 * l'autre.
 *
 * Toujours aucune dépendance d'icônes (cohérent avec tout le projet) :
 * SVG au trait, `currentColor` partout pour hériter la couleur du texte
 * parent, `aria-hidden` par défaut — ces icônes accompagnent toujours un
 * libellé texte, jamais seules porteuses de sens.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function Svg({ children, ...props }: IconProps) {
  return (
    <svg {...base} {...props}>
      {children}
    </svg>
  );
}

export const IconTruck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h11v9H3z" />
    <path d="M14 10h4l3 3v3h-7z" />
    <circle cx="7" cy="18" r="1.6" />
    <circle cx="17" cy="18" r="1.6" />
  </Svg>
);
export const IconWallet = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h12v4" />
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <circle cx="16.5" cy="13" r="1.2" />
  </Svg>
);
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);
export const IconHeadset = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <rect x="2.5" y="13" width="4" height="6" rx="1.5" />
    <rect x="17.5" y="13" width="4" height="6" rx="1.5" />
    <path d="M19.5 19v.5a2.5 2.5 0 0 1-2.5 2.5h-2" />
  </Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.5" />
  </Svg>
);
export const IconSparkles = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
    <path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z" />
  </Svg>
);
export const IconStar = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 9.7l5.4-.8z" />
  </Svg>
);
export const IconChef = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 14a4 4 0 1 1 1.2-7.8 4 4 0 0 1 7.6 0A4 4 0 1 1 17 14z" />
    <path d="M7 14h10v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" />
  </Svg>
);
export const IconLeaf = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 19C4 12 8 5 19 5c0 11-7 15-14 14z" />
    <path d="M9 15c2-3 5-5 8-6" />
  </Svg>
);
export const IconScissors = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="7" r="2.2" />
    <circle cx="6" cy="17" r="2.2" />
    <path d="M8 8.5 20 18M8 15.5 20 6" />
  </Svg>
);
export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);
export const IconBriefcase = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" />
  </Svg>
);
export const IconHandshake = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11l4-4 3 2 3-2 4 4" />
    <path d="M7 13l3 3 2-2 2 2 3-3" />
  </Svg>
);
export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="3.5" />
    <path d="M11.5 12H21l-2 2.5M17 12v3" />
  </Svg>
);
export const IconRuler = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="8" width="19" height="8" rx="1.5" />
    <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
  </Svg>
);
export const IconWhatsapp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 20.5 5 16.6A8 8 0 1 1 8.2 19z" />
    <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5.6 0 1-.5 1-1l-1.4-.7-1 .8a4.6 4.6 0 0 1-2.2-2.2l.8-1L11 9.5c0-.5-.4-1-1-1s-1 .5-1 1z" />
  </Svg>
);
export const IconBag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8h14l-1 12H6z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);
export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);
export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IconMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </Svg>
);
export const IconPhone = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4h3l2 5-2 1.5a11 11 0 0 0 5.5 5.5L15 14l5 2v3a1.5 1.5 0 0 1-1.7 1.5A16 16 0 0 1 3.5 5.7 1.5 1.5 0 0 1 5 4z" />
  </Svg>
);

const HIGHLIGHT_ICONS: Record<StorefrontIconKey, (props: IconProps) => JSX.Element> = {
  truck: IconTruck,
  wallet: IconWallet,
  shield: IconShield,
  headset: IconHeadset,
  clock: IconClock,
  pin: IconPin,
  sparkles: IconSparkles,
  star: IconStar,
  chef: IconChef,
  leaf: IconLeaf,
  scissors: IconScissors,
  calendar: IconCalendar,
  briefcase: IconBriefcase,
  handshake: IconHandshake,
  key: IconKey,
  ruler: IconRuler,
  whatsapp: IconWhatsapp,
  bag: IconBag,
};

/** Rendu d'une icône par clé. Clé inconnue -> `IconSparkles` : jamais un trou dans la grille. */
export function HighlightIcon({ name, ...props }: { name: StorefrontIconKey } & IconProps) {
  const Component = HIGHLIGHT_ICONS[name] ?? IconSparkles;
  return <Component {...props} />;
}

/**
 * Moyens de paiement : pastille texte, PAS le logo officiel de
 * l'opérateur. Décision assumée — redistribuer les marques MTN, Orange,
 * Visa ou Mastercard dans un produit SaaS engage la responsabilité de
 * chaque tenant sur des marques dont il ne détient aucune licence. Le
 * rendu reste lisible et le commerçant garde la main sur la liste.
 */
export function PaymentBadge({ method, label }: { method: PaymentMethodKey; label: string }) {
  return (
    <span
      data-payment={method}
      className="inline-flex items-center rounded-md border border-current/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"
    >
      {label}
    </span>
  );
}
