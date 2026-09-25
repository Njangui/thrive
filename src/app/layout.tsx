import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "./_components/service-worker-register";
import { PLATFORM_FONT_VARIABLES } from "./fonts";

/**
 * Paire de polices pour la landing marketing flexco  et la console Super
 * Admin (`/admin/*`) UNIQUEMENT — n'a rien à voir avec `displayFont`/
 * `bodyFont` ci-dessus, qui restent le mécanisme de police PAR TENANT de
 * la vitrine publique (`resolveTenantFontClassName`, non touché ici).
 * Chargées ici (root layout, une seule fois) plutôt que dans chaque
 * composant pour respecter la règle Next.js sur `next/font` (doit être
 * appelé au niveau module d'un composant, pas conditionnellement) et
 * pour ne payer le poids de ces deux fontes qu'une fois pour tout
 * l'app router. `display: "swap"` pour ne jamais bloquer le rendu si le
 * réseau est lent (cohérent avec le choix déjà fait ailleurs dans le
 * projet de ne jamais dépendre d'une ressource externe pour le rendu
 * initial).
 *
 * `<body>` reste sur le thème neutre `bg-paper font-body text-ink`
 * (volontairement PAS passé en violet/navy lors du chantier d'unification
 * design, sept. 2026) : c'est le fallback hérité par la vitrine publique
 * d'un tenant et par `error.tsx`/`not-found.tsx` (voir leurs notes), qui
 * s'appliquent à tous les contextes sans distinction. Chaque zone
 * réellement unifiée (landing marketing, admin, dashboard, login/
 * onboarding/invite, pages légales) impose son propre fond via
 * `.mkt-shell`/`.adm-shell` sur son wrapper — ce défaut de `<body>` ne les
 * concerne donc pas en pratique.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["500", "600", "700", "800"],
  display: "swap",
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "flexco  — Plus qu’un outil, un levier de croissance.",
  description: "Gérez. Vendez. Communiquez. Faites grandir votre entreprise.",
  // Manifest PWA global (Lot E, Partie 3) : neutre, pas de branding tenant
  // (voir public/manifest.json — le favicon PAR TENANT de la vitrine
  // publique est géré séparément via generateMetadata dans app/page.tsx).
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
  },
};

export const viewport: Viewport = {
  themeColor: "#0F172A",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={`${PLATFORM_FONT_VARIABLES} ${jakarta.variable} ${inter.variable}`}>
      <body className="bg-slate-50 font-body text-navy-900 antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
