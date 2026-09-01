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
 *
 * `primary/success/danger/warning/surface/sidebar` : NOUVELLE identité
 * visuelle du chrome dashboard (interne, PAS la vitrine publique), demandée
 * explicitement par le porteur du produit sur références visuelles
 * (violet/indigo + sidebar sombre pour le dashboard marchand, sidebar claire
 * pour la console super-admin). Ajoutés en PLUS des tokens ci-dessus, sans
 * les retirer : les pages déjà écrites avec `ink/paper/leaf/clay` continuent
 * de fonctionner à l'identique pendant la migration progressive, page par
 * page, plutôt qu'une réécriture globale d'un coup (non vérifiable ici :
 * pas d'accès réseau dans ce bac à sable pour lancer build/typecheck).
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

        // --- Nouvelle identité visuelle (dashboard marchand + console admin) ---
        primary: {
          DEFAULT: "#7C3AED",
          dark: "#6D28D9",
          light: "#EDE9FE",
        },
        accent: {
          pink: "#EC4899",
        },
        success: {
          DEFAULT: "#16A34A",
          light: "#DCFCE7",
        },
        danger: {
          DEFAULT: "#EF4444",
          light: "#FEE2E2",
        },
        warning: {
          DEFAULT: "#F59E0B",
          light: "#FEF3C7",
        },
        surface: "#F8F7FC",
        "sidebar-dark": {
          DEFAULT: "#1E1A2B",
          hover: "#2A2440",
        },
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
