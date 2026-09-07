/**
 * Icônes SVG minimalistes pour la console Super Admin (`/admin/*`).
 *
 * Le projet n'a délibérément aucune dépendance d'icônes (pas de
 * lucide-react/heroicons dans package.json — cohérent avec le reste des
 * choix de dépendances du projet, cf. tailwind.config.ts). Plutôt que
 * d'en ajouter une pour ce seul besoin visuel, ce fichier définit un
 * petit jeu d'icônes trait (stroke, 24x24, viewBox cohérent) suffisant
 * pour la sidebar, la topbar et les cartes de stats. `currentColor`
 * partout pour hériter la couleur du texte parent sans prop dédiée.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconGrid(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function IconBuilding(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="3" width="12" height="18" rx="1" />
      <path d="M9 8h2M9 12h2M9 16h2M16 10h4v11h-4" />
    </svg>
  );
}

export function IconTag(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M11.5 3.5 20 12l-8 8-8.5-8.5V4a.5.5 0 0 1 .5-.5Z" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  );
}

export function IconPhone(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18h2" />
    </svg>
  );
}

export function IconPlug(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 3v5M15 3v5M6 8h12l-1 4a5 5 0 0 1-5 4h0a5 5 0 0 1-5-4L6 8Z" />
      <path d="M12 16v5" />
    </svg>
  );
}

export function IconCard(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M2.5 10h19" />
    </svg>
  );
}

export function IconList(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

export function IconPuzzle(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M9 3.5h3a1.5 1.5 0 0 1 1.4 2.1 1.5 1.5 0 0 0 1.4 2.1H17a2 2 0 0 1 2 2v2.2a1.5 1.5 0 0 0-2.1 1.4 1.5 1.5 0 0 0 2.1 1.4V17a2 2 0 0 1-2 2h-2.2a1.5 1.5 0 0 0-2.8 0H9a2 2 0 0 1-2-2v-3a1.5 1.5 0 0 0-2.1 1.4A1.5 1.5 0 0 1 3.5 14v-3A1.5 1.5 0 0 1 5 9.5a1.5 1.5 0 0 0-1.5-1.5V6a2 2 0 0 1 2-2h1.5a1.5 1.5 0 0 0 2-.5Z" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14 18 8Z" />
      <path d="M10.5 19a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconLogout(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M15 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h8" />
      <path d="M10.5 12H21m0 0-3.5-3.5M21 12l-3.5 3.5" />
    </svg>
  );
}

export function IconUsers(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19c.6-3 3-5 6.2-5s5.6 2 6.2 5" />
      <path d="M16 4.2a3.2 3.2 0 0 1 0 6.3M19.5 19c-.5-2.4-1.9-4.1-3.9-4.8" />
    </svg>
  );
}

export function IconBanknote(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9v0M18 15v0" />
    </svg>
  );
}

export function IconBot(props: IconProps) {
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

export function IconAlert(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <svg {...base} {...props} strokeWidth={1.6}>
      <path d="M12 3.5c.7 3 2 4.3 5 5-3 .7-4.3 2-5 5-.7-3-2-4.3-5-5 3-.7 4.3-2 5-5Z" />
      <path d="M19 14.5c.35 1.4.95 2 2.35 2.35-1.4.35-2 .95-2.35 2.35-.35-1.4-.95-2-2.35-2.35 1.4-.35 2-.95 2.35-2.35Z" />
    </svg>
  );
}
