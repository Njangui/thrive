import type { Config } from "tailwindcss";

/**
 * Deux familles de tokens couleur, volontairement séparées :
 *  - `brand-*` : personnalisable PAR TENANT (logo pour l'instant — les
 *    couleurs ne sont pas dans Business Data du doc 2, donc pas encore
 *    branchées ; les vars restent prêtes si ça change).
 *  - `ink/paper/leaf/clay/muted` : palette FIXE de la plateforme pour le
 *    chrome de la vitrine publique (typo, fonds, CTA WhatsApp). Choisie
 *    pour ne pas retomber sur les trois looks IA par défaut (crème+terracotta,
 *    fond quasi-noir+accent vif, ou style "broadsheet"). Ancrée dans le sujet
 *    réel : reçu/étiquette de marché — d'où l'accent "leaf" fonctionnel
 *    (CTA WhatsApp) plutôt que décoratif.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "var(--brand-primary, #0f172a)",
          secondary: "var(--brand-secondary, #10b981)",
        },
        ink: "#1C1B19",
        paper: "#F3F1EC",
        leaf: "#178A4C",
        clay: "#C1562C",
        muted: "#6B6459",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
      },
      borderRadius: {
        brand: "var(--brand-radius, 0.5rem)",
      },
    },
  },
  plugins: [],
};

export default config;
