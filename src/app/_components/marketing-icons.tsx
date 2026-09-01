const PATHS: Record<string, string> = {
  check: "M20 6 9 17l-5-5",
  diamond: "M12 2 2 12l10 10 10-10L12 2Z",
  box: "M3 7l9-4 9 4-9 4-9-4Zm0 0v10l9 4m0-14v14m9-14v10l-9 4",
  users: "M16 11a4 4 0 1 0-4-4M8 21v-2a4 4 0 0 1 4-4h1m6 6v-2a4 4 0 0 0-3-3.87M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Zm13-4a5 5 0 0 1 0 10m2-14a9 9 0 0 1 0 18",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z",
  chat: "M4 5h16v10H8l-4 4V5Z",
  star: "M12 3l2.6 5.6 6.1.6-4.6 4.2 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.3 9.2l6.1-.6L12 3Z",
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  shield: "M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3Z",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3ZM3.5 9h17M3.5 15h17",
  headset: "M4 13v-1a8 8 0 1 1 16 0v1M4 13a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v-6H4Zm16 0h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1v-6Zm-1 6v1a2 2 0 0 1-2 2h-3",
};

export function MIcon({ name, className = "h-5 w-5" }: { name: keyof typeof PATHS; className?: string }) {
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
