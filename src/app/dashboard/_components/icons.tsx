/**
 * Icônes ligne minimalistes, en SVG inline — même choix que l'icône cloche
 * déjà inlinée dans l'ancien dashboard/layout.tsx : pas de dépendance npm
 * supplémentaire (lucide-react etc.) qui ne pourrait pas être vérifiée par
 * un `npm install` dans cet environnement sans accès réseau.
 */
const PATHS: Record<string, string> = {
  overview: "M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z",
  catalog: "M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4m0-14v14m9-14v10l-9 4",
  orders: "M6 3h12l1 5H5l1-5Zm-1 5h14l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 8Zm4 4h6",
  clients: "M16 11a4 4 0 1 0-4-4M8 21v-2a4 4 0 0 1 4-4h1m6 6v-2a4 4 0 0 0-3-3.87M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  conversations: "M4 5h16v10H8l-4 4V5Z",
  comments: "M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-4-1L3 20l1-5.5A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5Z",
  appointments: "M8 3v4M16 3v4M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z",
  marketing: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Zm13-4a5 5 0 0 1 0 10m2-14a9 9 0 0 1 0 18",
  site: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3ZM3.5 9h17M3.5 15h17",
  finance: "M4 6h16v12H4V6Zm0 4h16M8 15h4",
  subscription: "M4 7h16v10H4V7Zm0 3h16M7 15h3",
  team: "M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2m14 0v-2a4 4 0 0 0-3-3.87M13 3.13a4 4 0 0 1 0 7.75M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.15-1.55l2-1.55-2-3.46-2.37.96a8.07 8.07 0 0 0-2.68-1.55L16.4 2h-4l-.4 2.85a8.07 8.07 0 0 0-2.68 1.55L6.55 5.44l-2 3.46 2 1.55a8.15 8.15 0 0 0 0 3.1l-2 1.55 2 3.46 2.37-.96c.8.68 1.71 1.2 2.68 1.55L12.4 22h4l.4-2.85a8.07 8.07 0 0 0 2.68-1.55l2.37.96 2-3.46-2-1.55c.1-.5.15-1.02.15-1.55Z",
  chevron: "M9 6l6 6-6 6",
  bell: "M15 17h5l-1.4-2.1a2 2 0 0 1-.35-1.13V10a6.25 6.25 0 1 0-12.5 0v3.77c0 .4-.12.79-.35 1.13L4 17h5m6 0a3 3 0 1 1-6 0m6 0H9",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-.75-6.5v-.2c0-.68.4-1.1 1.1-1.55.75-.48 1.15-.85 1.15-1.55 0-.75-.6-1.2-1.4-1.2-.7 0-1.25.35-1.5.95m1.4 5.9h.02",
  plus: "M12 5v14M5 12h14",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m6 4 4 4-4 4M9 12h11",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6 6 18",
};

export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof PATHS; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
