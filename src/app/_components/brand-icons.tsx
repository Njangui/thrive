/**
 * Repères visuels (logomarks) des réseaux sociaux — utilisés partout où
 * CRESYVA affiche "quel réseau est-ce" (canaux, analytics, commentaires,
 * site). Distinct de `app-icons.tsx` (icônes UI génériques en trait,
 * `currentColor`, 24x24) : ici chaque glyphe est un aplat (`fill`) pensé
 * pour être posé en blanc sur le badge de couleur/dégradé propre à la
 * marque (voir `SOCIAL_BRAND` ci-dessous) plutôt que d'hériter la couleur
 * du texte environnant.
 *
 * Source unique (sept. 2026, suite à la demande de vraies icônes/couleurs
 * sur `/dashboard/channels`) : `SOCIAL_BRAND` regroupe pour chaque
 * plateforme son glyphe ET sa classe de fond officielle, pour que tout
 * nouvel écran qui affiche un badge réseau reprenne exactement les mêmes
 * couleurs sans les redéfinir.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function IconInstagramGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4.3" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.15" cy="6.85" r="1.05" fill="currentColor" />
    </svg>
  );
}

export function IconFacebookGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M14.2 21v-7.85h2.63l.4-3.06h-3.03V8.1c0-.89.25-1.49 1.52-1.49h1.62V3.86c-.28-.04-1.24-.12-2.36-.12-2.34 0-3.94 1.43-3.94 4.04v2.35H8.4v3.06h2.64V21h3.16Z" />
    </svg>
  );
}

export function IconLinkedInGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M7.55 9.65H4.75V19h2.8V9.65Zm-1.4-1.27a1.62 1.62 0 1 0 0-3.24 1.62 1.62 0 0 0 0 3.24ZM19.25 19h-2.79v-5.06c0-1.21-.43-2.03-1.51-2.03-.82 0-1.31.55-1.53 1.09-.08.19-.1.46-.1.72V19H10.5s.04-8.55.03-9.35H12.8v1.32h-.02c.37-.7 1.3-1.32 2.68-1.32 1.96 0 3.44 1.28 3.44 4.02V19Z" />
    </svg>
  );
}

export function IconTikTokGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M16.6 3c.38 2.31 1.85 3.9 4.4 4.16v3.02a7.3 7.3 0 0 1-4.36-1.4v6.6a5.72 5.72 0 1 1-5.72-5.72c.24 0 .48.02.7.05v3.06a2.7 2.7 0 1 0 1.9 2.6V3h3.08Z" />
    </svg>
  );
}

export function IconXGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M4.3 4h3.34l4.03 5.4L16.24 4h2.57l-5.44 6.9L19.1 20h-3.34l-4.36-5.83L6.9 20H4.33l5.7-7.2L4.3 4Z" />
    </svg>
  );
}

export function IconYouTubeGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M10 8.6 15.8 12 10 15.4V8.6Z" />
    </svg>
  );
}

export function IconTelegramGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="m4 12.3 15.2-6c.7-.27 1.3.17 1.06 1.24l-2.58 12.16c-.19.87-.7 1.08-1.42.68l-3.94-2.9-1.9 1.83c-.21.21-.39.39-.79.39l.28-3.99 7.26-6.56c.32-.28-.07-.44-.48-.16l-8.97 5.65-3.87-1.21c-.84-.26-.86-.84.18-1.24Z" />
    </svg>
  );
}

export function IconWhatsAppGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.02 3C7.05 3 3.02 7.03 3.02 12c0 1.68.46 3.25 1.26 4.6L3 21l4.53-1.24A8.93 8.93 0 0 0 12.02 21C16.98 21 21 16.97 21 12s-4.02-9-8.98-9Zm5.24 12.78c-.22.62-1.28 1.17-1.77 1.22-.45.05-.9.24-3.02-.63-2.55-1.05-4.2-3.63-4.33-3.8-.13-.17-1.03-1.37-1.03-2.62s.66-1.86.9-2.12c.22-.24.49-.3.65-.3l.47.01c.15 0 .35-.06.55.42.22.53.74 1.83.8 1.96.06.13.1.28.02.45-.08.17-.13.28-.25.43-.13.15-.27.34-.38.45-.13.13-.26.27-.11.53.15.26.66 1.09 1.42 1.77.98.87 1.8 1.15 2.06 1.28.26.13.41.11.56-.06.15-.17.63-.73.8-.98.17-.26.34-.21.56-.13.22.09 1.42.67 1.66.79.24.13.4.19.46.29.06.11.06.62-.16 1.24Z" />
    </svg>
  );
}

export type SocialPlatformKey = "instagram" | "facebook" | "linkedin" | "tiktok" | "twitter" | "youtube" | "telegram" | "whatsapp";

/**
 * Glyphe + habillage officiel par réseau. `badgeClassName` pose le fond
 * (couleur ou dégradé de marque) ; le glyphe est toujours rendu en blanc
 * par-dessus (`text-white`).
 */
export const SOCIAL_BRAND: Record<SocialPlatformKey, { label: string; Icon: (p: IconProps) => JSX.Element; badgeClassName: string }> = {
  instagram: { label: "Instagram", Icon: IconInstagramGlyph, badgeClassName: "bg-gradient-to-br from-[#FEDA75] via-[#D62976] to-[#4F5BD5]" },
  facebook: { label: "Facebook", Icon: IconFacebookGlyph, badgeClassName: "bg-[#1877F2]" },
  linkedin: { label: "LinkedIn", Icon: IconLinkedInGlyph, badgeClassName: "bg-[#0A66C2]" },
  tiktok: { label: "TikTok", Icon: IconTikTokGlyph, badgeClassName: "bg-black" },
  twitter: { label: "X / Twitter", Icon: IconXGlyph, badgeClassName: "bg-black" },
  youtube: { label: "YouTube", Icon: IconYouTubeGlyph, badgeClassName: "bg-[#FF0000]" },
  telegram: { label: "Telegram", Icon: IconTelegramGlyph, badgeClassName: "bg-[#26A5E4]" },
  whatsapp: { label: "WhatsApp", Icon: IconWhatsAppGlyph, badgeClassName: "bg-[#25D366]" },
};
