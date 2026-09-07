import type { SVGProps } from "react";

/**
 * Icônes de la grille "Fonctionnalités" de la landing marketing.
 * Volontairement séparées de `admin/_components/icons.tsx` (même si
 * certaines formes se ressemblent) : la landing publique et la console
 * `/admin/*` ne doivent rien s'importer l'une l'autre, ce sont deux
 * surfaces indépendantes. Même choix qu'ailleurs dans le projet :
 * aucune dépendance d'icônes, SVG trait fait main.
 */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconBox(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 8 12 3.5 20.5 8 12 12.5 3.5 8Z" />
      <path d="M3.5 8v9L12 21.5l8.5-4.5V8" />
      <path d="M12 12.5v9" />
    </svg>
  );
}

export function IconChat(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4Z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}

export function IconMegaphone(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 10v4h3l6 4V6l-6 4Z" />
      <path d="M15 8.5a4.5 4.5 0 0 1 0 7" />
      <path d="M17.5 6a8 8 0 0 1 0 12" />
    </svg>
  );
}

export function IconUsersGroup(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.6-3 3-5 6.2-5s5.6 2 6.2 5" />
      <path d="M16 4.2a3.2 3.2 0 0 1 0 6.3M19.5 19c-.5-2.4-1.9-4.1-3.9-4.8" />
    </svg>
  );
}

export function IconCoins(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="9" cy="7" rx="5.5" ry="3" />
      <path d="M3.5 7v4c0 1.66 2.46 3 5.5 3s5.5-1.34 5.5-3V7" />
      <path d="M3.5 11v4c0 1.66 2.46 3 5.5 3 .9 0 1.75-.12 2.5-.34" />
      <path d="M14.5 12.3c2.9.2 5-1 5-2.55v8c0 1.66-2.46 3-5.5 3-2.2 0-4.1-.7-5-1.75" />
    </svg>
  );
}

export function IconGlobeSite(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}

export function IconBotAssist(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V4.5M9 3.8h6" />
      <circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9.5 17h5" />
    </svg>
  );
}

export function IconTrendUp(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 17 10 10.5l4 4 6.5-7.5" />
      <path d="M15.5 6.5h5v5" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M4.5 12h15M13 5.5 19.5 12 13 18.5" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
